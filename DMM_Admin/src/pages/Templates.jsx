import RepositoryPage from '../components/RepositoryPage.jsx';
import { templateApi } from '../api/endpoints.js';

const TEMPLATE_CATEGORIES = [
  'Placement', 'Admissions', 'Workshops', 'Events',
  'Certifications', 'Recruitment', 'Social Media Campaigns',
];

export default function Templates() {
  return (
    <RepositoryPage
      cfg={{
        key: 'templates',
        api: templateApi,
        listField: 'templates',
        title: 'Template Repository',
        subtitle: 'Reusable marketing templates for every campaign. Anyone can upload; only the super admin can remove.',
        singular: 'Template',
        plural: 'Templates',
        categories: TEMPLATE_CATEGORIES,
        thumbField: 'thumbnail',
        thumbFieldName: 'thumbnail',
        thumbLabel: 'Thumbnail',
        accept: '.png,.jpg,.jpeg,.pdf,.ppt,.pptx,.psd,.ai,image/*,application/pdf',
      }}
    />
  );
}
