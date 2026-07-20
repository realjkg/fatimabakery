import { createHash } from 'node:crypto';

export const ApprovalDecision = Object.freeze({
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  NEEDS_REVISION: 'NEEDS_REVISION'
});

export const ExportChannel = Object.freeze({
  NEWSLETTER: 'newsletter',
  HOTPLATE_DROP: 'hotplate_drop',
  WEBSITE_CONTENT: 'website_content'
});

const CHANNELS = new Set(Object.values(ExportChannel));
const DECISIONS = new Set(Object.values(ApprovalDecision));

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function proposalContentHash(proposal) {
  return createHash('sha256').update(canonicalJson(proposal)).digest('hex');
}

export function assertValidatedProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') throw new Error('Proposal is required.');
  const proposalId = proposal.proposalId ?? proposal.contentId;
  if (!/^cnt_[a-z0-9][a-z0-9_-]*$/.test(proposalId ?? '')) throw new Error('Proposal must have a stable cnt_ proposalId or contentId.');
  if (proposal.schemaVersion !== '1.0.0') throw new Error('Proposal schemaVersion must be 1.0.0.');
  if (!proposal.editorial && !Array.isArray(proposal.sections)) throw new Error('Proposal must include editorial copy or newsletter sections.');
  return proposalId;
}

export function summarizeProposalForReview(proposal) {
  const proposalId = assertValidatedProposal(proposal);
  const items = Array.isArray(proposal.items) ? proposal.items.map((item) => ({
    productId: item.productId,
    weeklyInventoryId: item.weeklyInventoryId,
    displayName: item.displayName,
    quantityAvailable: item.quantityAvailable,
    unitPrice: item.unitPrice,
    hasDescription: Boolean(item.description)
  })) : [];
  return {
    proposalId,
    schemaVersion: proposal.schemaVersion,
    status: proposal.status,
    contentHash: proposalContentHash(proposal),
    headline: proposal.editorial?.headline ?? proposal.subject,
    summary: proposal.editorial?.summary ?? proposal.previewText ?? proposal.sections?.[0]?.body,
    itemCount: items.length,
    items,
    approvalState: proposal.approval?.state ?? 'not_requested'
  };
}

export class EditorialApprovalStore {
  constructor({ events = [], idempotency = new Map() } = {}) {
    this.events = [...events];
    this.idempotency = new Map(idempotency);
  }

  listEvents(proposalId) {
    return this.events.filter((event) => event.proposalId === proposalId).map((event) => ({ ...event }));
  }

  latestDecision(proposalId) {
    return this.listEvents(proposalId).at(-1) ?? null;
  }

  recordDecision(command) {
    const { proposal, decision, reviewedBy, approvedBy, reviewedAt, note, auditCorrelationId, idempotencyKey } = command;
    const proposalId = assertValidatedProposal(proposal);
    if (!DECISIONS.has(decision)) throw new Error(`Unsupported approval decision: ${decision}`);
    const reviewer = reviewedBy ?? approvedBy;
    if (!reviewer) throw new Error('reviewedBy or approvedBy is required.');
    if (!auditCorrelationId) throw new Error('auditCorrelationId is required.');
    const proposalContentHashValue = proposalContentHash(proposal);
    const fingerprint = canonicalJson({ proposalId, decision, reviewer, proposalContentHash: proposalContentHashValue, note: note ?? '', auditCorrelationId });
    if (idempotencyKey) {
      const existing = this.idempotency.get(idempotencyKey);
      if (existing && existing.fingerprint !== fingerprint) throw new Error('Idempotency key was reused for a conflicting approval command.');
      if (existing) return { ...existing.event, idempotentReplay: true };
    }
    const event = Object.freeze({
      approvalEventId: `aud_${createHash('sha256').update(`${auditCorrelationId}:${proposalId}:${decision}:${proposalContentHashValue}:${this.events.length}`).digest('hex').slice(0, 16)}`,
      proposalId,
      decision,
      ...(decision === ApprovalDecision.APPROVED ? { approvedBy: reviewer } : { reviewedBy: reviewer }),
      reviewedAt: reviewedAt ?? new Date().toISOString(),
      proposalContentHash: proposalContentHashValue,
      ...(note ? { note } : {}),
      auditCorrelationId
    });
    this.events.push(event);
    if (idempotencyKey) this.idempotency.set(idempotencyKey, { fingerprint, event });
    return { ...event };
  }
}

function approvedEventFor(proposal, approvalEvents, expectedContentHash) {
  const proposalId = assertValidatedProposal(proposal);
  const hash = proposalContentHash(proposal);
  if (expectedContentHash !== hash) throw new Error('Proposal content hash does not match export request.');
  const event = approvalEvents.filter((candidate) => candidate.proposalId === proposalId).at(-1);
  if (!event || event.decision !== ApprovalDecision.APPROVED) throw new Error('Only approved proposals can be exported.');
  if (event.proposalContentHash !== hash) throw new Error('Approved proposal hash does not match current proposal contents.');
  return event;
}

function operationalWarnings(proposal) {
  const warnings = [];
  for (const item of proposal.items ?? []) {
    if (!item.productId || !item.weeklyInventoryId) warnings.push(`Missing stable identifiers for ${item.displayName ?? 'item'}.`);
    if (item.quantityAvailable === undefined) warnings.push(`Missing authoritative availability for ${item.displayName}.`);
    if (item.unitPrice === undefined) warnings.push(`Missing authoritative price for ${item.displayName}.`);
  }
  const ops = proposal.operational ?? {};
  if (!ops.orderDeadline) warnings.push('Missing authoritative ordering deadline.');
  if (!ops.fulfillmentDetails && !ops.fulfillmentOrCutoffNote) warnings.push('Missing authoritative fulfillment or cutoff details.');
  return warnings;
}

export function exportApprovedProposal({ proposal, approvalEvents, expectedContentHash, channel }) {
  if (!CHANNELS.has(channel)) throw new Error(`Unsupported export channel: ${channel}`);
  const approvalEvent = approvedEventFor(proposal, approvalEvents, expectedContentHash);
  const warnings = operationalWarnings(proposal);
  const ops = proposal.operational ?? {};
  const editorial = proposal.editorial ?? {};
  const items = proposal.items ?? [];
  const productHighlights = items.map((item) => ({
    productId: item.productId,
    weeklyInventoryId: item.weeklyInventoryId,
    name: item.displayName,
    description: item.description ?? '',
    availability: item.quantityAvailable === undefined ? undefined : `${item.quantityAvailable} available`,
    price: item.unitPrice === undefined ? undefined : `$${item.unitPrice.toFixed(2)}`
  }));
  const common = { channel, proposalId: approvalEvent.proposalId, approvalEventId: approvalEvent.approvalEventId, contentHash: expectedContentHash, warnings, published: false, sentEmail: false, calledHotplateApi: false, mutatedWebsite: false };
  if (channel === ExportChannel.NEWSLETTER) return { ...common, export: { subject: proposal.subject ?? editorial.headline, previewText: proposal.previewText ?? editorial.summary, heading: editorial.headline, body: editorial.longDescription ?? editorial.summary, productHighlights, orderCallToAction: editorial.callToAction ?? ops.callToAction, fulfillmentOrCutoffNote: ops.fulfillmentOrCutoffNote ?? ops.fulfillmentDetails, footer: proposal.footer ?? 'Fatima Bakery ATX' } };
  if (channel === ExportChannel.HOTPLATE_DROP) return { ...common, export: { dropTitle: editorial.headline, shortIntroduction: editorial.summary, productDescriptions: productHighlights, quantityOrAvailabilityLanguage: productHighlights.map((item) => `${item.name}: ${item.availability ?? 'availability not supplied'}`), orderingDeadline: ops.orderDeadline, pickupOrDeliveryDetails: ops.fulfillmentDetails, callToAction: editorial.callToAction ?? ops.callToAction } };
  return { ...common, export: { heading: editorial.headline, shortFeatureCopy: editorial.summary, productOrCollectionDescription: items.map((item) => item.description).filter(Boolean).join('\n\n') || editorial.longDescription, callToAction: editorial.callToAction ?? ops.callToAction, seoTitle: proposal.website?.seoTitle, seoDescription: proposal.website?.seoDescription } };
}
