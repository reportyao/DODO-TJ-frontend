
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
      <picture>
        <source srcSet="/brand/empty_cart.webp" type="image/webp" />
        <img 
          src="/brand/empty_cart.png" 
          alt="Page not found"
          className="w-40 h-40 mb-4 opacity-80"
          style={{ objectFit: 'contain' }}
        />
      </picture>
      <h1 className="text-6xl font-bold text-gray-800">404</h1>
      <h2 className="text-2xl font-semibold mt-4 mb-2 text-gray-600">{t('error.pageNotFound')}</h2>
      <p className="text-gray-500 mb-6 text-center">
        {t('error.pageNotFoundDescription')}
      </p>
      <button 
        onClick={() => navigate('/')}
        className="px-4 py-2 bg-primary text-white rounded-lg shadow hover:bg-primary-dark transition-colors"
      >
        {t('common.backToHome')}
      </button>
    </div>
  );
}
