import mongoose from 'mongoose';

// An institution's website / domain in our inventory: the live domain, what kind
// of site it is, where it's hosted and what it's built with. Optionally linked to
// an organization (best-effort name match), but stands on its own since some rows
// are landing pages / sub-apps rather than full tenants.
const websiteSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true, default: null },
    institution: { type: String, required: true, trim: true }, // display name (NCET, NDC Application, …)
    domain: { type: String, default: '', trim: true }, // https://…
    siteType: { type: String, default: '' }, // Static | Server | Hybrid | Dynamic
    hosting: { type: String, default: '' }, // CloudFlare | AWS | …
    builtWith: { type: String, default: '' }, // AstroJS | NextJS with Strapi CMS | …
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

websiteSchema.index({ institution: 1, domain: 1 });

const Website = mongoose.model('Website', websiteSchema);
export default Website;
