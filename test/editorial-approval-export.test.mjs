import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ApprovalDecision,
  EditorialApprovalStore,
  ExportChannel,
  exportApprovedProposal,
  proposalContentHash,
  summarizeProposalForReview
} from '../lib/editorial-approval-export.mjs';
import { weeklyDropProposal } from './fixtures/editorial-proposal.mjs';

function approve(store = new EditorialApprovalStore(), proposal = weeklyDropProposal) {
  return store.recordDecision({
    proposal,
    decision: ApprovalDecision.APPROVED,
    reviewedBy: 'owner_lindsay',
    reviewedAt: '2026-07-20T12:00:00.000Z',
    auditCorrelationId: 'corr_editorial_approval_001',
    idempotencyKey: 'approval-cnt-2026w32-0001'
  });
}

test('a validated proposal can be summarized and approved without mutation', () => {
  const before = structuredClone(weeklyDropProposal);
  const summary = summarizeProposalForReview(weeklyDropProposal);
  assert.equal(summary.proposalId, 'cnt_2026w32_drop');
  assert.equal(summary.itemCount, 2);
  const store = new EditorialApprovalStore();
  const event = approve(store);
  assert.equal(event.decision, ApprovalDecision.APPROVED);
  assert.equal(event.approvedBy, 'owner_lindsay');
  assert.deepEqual(weeklyDropProposal, before);
});

test('a proposal can be rejected and returned for revision', () => {
  const store = new EditorialApprovalStore();
  const rejected = store.recordDecision({ proposal: weeklyDropProposal, decision: ApprovalDecision.REJECTED, reviewedBy: 'owner_lindsay', auditCorrelationId: 'corr_reject' });
  const revision = store.recordDecision({ proposal: weeklyDropProposal, decision: ApprovalDecision.NEEDS_REVISION, reviewedBy: 'owner_lindsay', note: 'Make the cutoff clearer.', auditCorrelationId: 'corr_revision' });
  assert.equal(rejected.decision, ApprovalDecision.REJECTED);
  assert.equal(revision.decision, ApprovalDecision.NEEDS_REVISION);
  assert.equal(revision.note, 'Make the cutoff clearer.');
});

test('approval history is append-only', () => {
  const store = new EditorialApprovalStore();
  store.recordDecision({ proposal: weeklyDropProposal, decision: ApprovalDecision.REJECTED, reviewedBy: 'owner_lindsay', auditCorrelationId: 'corr_one' });
  store.recordDecision({ proposal: weeklyDropProposal, decision: ApprovalDecision.NEEDS_REVISION, reviewedBy: 'owner_lindsay', auditCorrelationId: 'corr_two' });
  assert.equal(store.listEvents('cnt_2026w32_drop').length, 2);
});

test('duplicate approval commands are idempotent and conflicting key reuse fails', () => {
  const store = new EditorialApprovalStore();
  const first = approve(store);
  const replay = approve(store);
  assert.equal(replay.approvalEventId, first.approvalEventId);
  assert.equal(replay.idempotentReplay, true);
  assert.throws(() => store.recordDecision({ proposal: weeklyDropProposal, decision: ApprovalDecision.REJECTED, reviewedBy: 'owner_lindsay', auditCorrelationId: 'corr_editorial_approval_001', idempotencyKey: 'approval-cnt-2026w32-0001' }), /conflicting/);
  assert.equal(store.listEvents('cnt_2026w32_drop').length, 1);
});

test('an unapproved proposal cannot be exported and changed hashes block export', () => {
  const store = new EditorialApprovalStore();
  const hash = proposalContentHash(weeklyDropProposal);
  assert.throws(() => exportApprovedProposal({ proposal: weeklyDropProposal, approvalEvents: store.listEvents('cnt_2026w32_drop'), expectedContentHash: hash, channel: ExportChannel.NEWSLETTER }), /approved/);
  approve(store);
  const changed = { ...weeklyDropProposal, editorial: { ...weeklyDropProposal.editorial, headline: 'Changed' } };
  assert.throws(() => exportApprovedProposal({ proposal: changed, approvalEvents: store.listEvents('cnt_2026w32_drop'), expectedContentHash: hash, channel: ExportChannel.NEWSLETTER }), /hash/);
});

test('newsletter export renders correctly and performs no send or publication', () => {
  const store = new EditorialApprovalStore();
  approve(store);
  const rendered = exportApprovedProposal({ proposal: weeklyDropProposal, approvalEvents: store.listEvents('cnt_2026w32_drop'), expectedContentHash: proposalContentHash(weeklyDropProposal), channel: ExportChannel.NEWSLETTER });
  assert.equal(rendered.export.subject, 'Friday bread is ready to reserve');
  assert.equal(rendered.export.productHighlights[0].price, '$12.00');
  assert.equal(rendered.sentEmail, false);
  assert.equal(rendered.published, false);
});

test('Hotplate drop export renders correctly and performs no API call', () => {
  const store = new EditorialApprovalStore();
  approve(store);
  const rendered = exportApprovedProposal({ proposal: weeklyDropProposal, approvalEvents: store.listEvents('cnt_2026w32_drop'), expectedContentHash: proposalContentHash(weeklyDropProposal), channel: ExportChannel.HOTPLATE_DROP });
  assert.equal(rendered.export.dropTitle, 'Friday sourdough drop');
  assert.match(rendered.export.quantityOrAvailabilityLanguage[0], /18 available/);
  assert.equal(rendered.calledHotplateApi, false);
});

test('website export renders correctly and performs no website mutation', () => {
  const store = new EditorialApprovalStore();
  approve(store);
  const rendered = exportApprovedProposal({ proposal: weeklyDropProposal, approvalEvents: store.listEvents('cnt_2026w32_drop'), expectedContentHash: proposalContentHash(weeklyDropProposal), channel: ExportChannel.WEBSITE_CONTENT });
  assert.equal(rendered.export.heading, 'Friday sourdough drop');
  assert.equal(rendered.export.seoTitle, 'Friday Sourdough Drop | Fatima Bakery ATX');
  assert.equal(rendered.mutatedWebsite, false);
});

test('operational values are not invented and missing authoritative data is warned about', () => {
  const proposal = { ...weeklyDropProposal, operational: {}, items: [{ ...weeklyDropProposal.items[0], quantityAvailable: undefined, unitPrice: undefined }] };
  const store = new EditorialApprovalStore();
  store.recordDecision({ proposal, decision: ApprovalDecision.APPROVED, reviewedBy: 'owner_lindsay', auditCorrelationId: 'corr_missing_ops' });
  const rendered = exportApprovedProposal({ proposal, approvalEvents: store.listEvents('cnt_2026w32_drop'), expectedContentHash: proposalContentHash(proposal), channel: ExportChannel.HOTPLATE_DROP });
  assert.equal(rendered.export.productDescriptions[0].availability, undefined);
  assert.equal(rendered.export.productDescriptions[0].price, undefined);
  assert.ok(rendered.warnings.some((warning) => warning.includes('availability')));
  assert.ok(rendered.warnings.some((warning) => warning.includes('price')));
});

test('approval records contain no unnecessary customer PII', () => {
  const store = new EditorialApprovalStore();
  const event = approve(store);
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /@/);
  assert.doesNotMatch(serialized, /phone|address|customer/i);
});
