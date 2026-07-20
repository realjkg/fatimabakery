export const weeklyDropProposal = Object.freeze({
  schemaVersion: '1.0.0',
  proposalId: 'cnt_2026w32_drop',
  fulfillmentWindowId: 'fw_2026w32_fri_pickup',
  status: 'pending_approval',
  items: [
    {
      productId: 'prod_country_sourdough',
      weeklyInventoryId: 'winv_2026w32_country',
      displayName: 'Country Sourdough',
      description: 'Naturally leavened country loaf with a crisp crust.',
      quantityAvailable: 18,
      unitPrice: 12.00
    },
    {
      productId: 'prod_cinnamon_rolls',
      weeklyInventoryId: 'winv_2026w32_cinnamon',
      displayName: 'Cinnamon Rolls',
      description: 'Soft sourdough rolls with brown sugar cinnamon filling.',
      quantityAvailable: 10,
      unitPrice: 16.00
    }
  ],
  editorial: {
    headline: 'Friday sourdough drop',
    summary: 'Country loaves and cinnamon rolls are ready for the Friday pickup window.',
    longDescription: 'This week focuses on slow-fermented staples for weekend breakfasts and shared tables.',
    callToAction: 'Reply to reserve from this approved export.'
  },
  subject: 'Friday bread is ready to reserve',
  previewText: 'Country sourdough and cinnamon rolls for Friday pickup.',
  operational: {
    orderDeadline: 'Thursday, July 30 at 6:00 PM CT',
    fulfillmentDetails: 'Pickup Friday, July 31 from 4:00–6:00 PM in Liberty Hill.',
    fulfillmentOrCutoffNote: 'Order by Thursday at 6:00 PM for Friday pickup.',
    callToAction: 'Reserve your loaf for Friday pickup.'
  },
  website: {
    seoTitle: 'Friday Sourdough Drop | Fatima Bakery ATX',
    seoDescription: 'Reserve Fatima Bakery country sourdough and cinnamon rolls for Friday pickup.'
  },
  footer: 'Fatima Bakery ATX — manual export only; approval is not publication.',
  approval: { state: 'pending' }
});
