import RepositoryPage from '../components/RepositoryPage.jsx';
import { assetApi } from '../api/endpoints.js';

const ASSET_CATEGORIES = [
  'Logos', 'Favicons', 'PNG Files', 'Backgrounds',
  'Icons', 'Illustrations', 'Brand Assets', 'Center of Excellence',
];

export default function Assets() {
  return (
    <RepositoryPage
      cfg={{
        key: 'assets',
        api: assetApi,
        listField: 'assets',
        title: 'Asset Repository',
        subtitle: 'Reusable branding assets and brand kit. Anyone can upload; only the super admin can remove.',
        singular: 'Asset',
        plural: 'Assets',
        categories: ASSET_CATEGORIES,
        thumbField: 'previewImage',
        thumbFieldName: 'preview',
        thumbLabel: 'Preview image',
        accept: '.png,.jpg,.jpeg,.svg,.ai,image/*',
      }}
    />
  );
}
