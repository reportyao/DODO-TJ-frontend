import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const SubsidyPlanPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const sections = [
    {
      title: t('subsidy.section1Title'),
      content: t('subsidy.section1Content'),
    },
    {
      title: t('subsidy.section2Title'),
      content: t('subsidy.section2Content'),
    },
    {
      title: t('subsidy.section3Title'),
      content: t('subsidy.section3Content'),
    },
    {
      title: t('subsidy.section4Title'),
      content: t('subsidy.section4Content'),
    },
    {
      title: t('subsidy.section5Title'),
      content: t('subsidy.section5Content'),
    },
  ].filter(section => section.title.trim() !== '');

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white shadow-sm">
        <div className="flex items-center px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ChevronLeft className="w-6 h-6 text-gray-700" />
          </button>
          <h1 className="flex-1 text-lg font-semibold text-gray-900 text-center pr-10">
            {t('subsidy.menuTitle')}
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-6 space-y-6">
        {/* Page Title */}
        <div className="bg-gradient-to-r from-orange-500 to-yellow-500 rounded-2xl p-6 text-white shadow-lg">
          <h2 className="text-xl font-bold leading-relaxed">
            {t('subsidy.pageTitle')}
          </h2>
        </div>

        {/* Sections */}
        {sections.map((section, index) => (
          <div
            key={index}
            className="bg-white rounded-xl p-5 shadow-sm border border-gray-100"
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              {section.title}
            </h3>
            <div className="text-gray-700 leading-relaxed whitespace-pre-line">
              {section.content.split('**').map((part, i) => {
                // Handle bold text
                if (i % 2 === 1) {
                  return <strong key={i}>{part}</strong>;
                }
                return <span key={i}>{part}</span>;
              })}
            </div>
          </div>
        ))}

        {/* Footer Note */}
        <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
          <p className="text-sm text-orange-800 text-center">
            💰 {t('subsidy.banner')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SubsidyPlanPage;
