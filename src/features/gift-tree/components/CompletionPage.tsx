/**
 * 希望之树 - 完成页面（核销码展示）
 *
 * 当树完成生长后，展示核销码和领取信息。
 * 用户可以到门店出示核销码领取礼物。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useGiftTreeStatus } from '../hooks/useGiftTree';

function getLocalizedText(
  i18n: Record<string, string> | undefined | null,
  lang: string
): string {
  if (!i18n) return '';
  return i18n[lang] || i18n['zh'] || i18n['en'] || Object.values(i18n)[0] || '';
}

const CompletionPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language || 'zh';
  const { data: status, isLoading } = useGiftTreeStatus();

  const tree = status?.tree;
  const giftItem = tree?.gift_item;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-3 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!tree || (tree.status !== 'COMPLETED' && tree.status !== 'CLAIMED')) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex flex-col items-center justify-center p-6">
        <span className="text-5xl mb-4">🌳</span>
        <p className="text-muted-foreground text-center">
          {t('giftTree.noCompletedTree', 'No completed tree found')}
        </p>
        <button
          onClick={() => navigate('/gift-tree')}
          className="mt-4 bg-accent text-white px-6 py-2.5 rounded-xl font-medium"
        >
          {t('giftTree.goToTree', 'Go to Tree')}
        </button>
      </div>
    );
  }

  const giftName = giftItem
    ? getLocalizedText(giftItem.name_i18n, lang) || giftItem.name
    : t('giftTree.gift', 'Gift');

  const expiresAt = tree.pickup_code_expires_at
    ? new Date(tree.pickup_code_expires_at).toLocaleDateString()
    : '';

  const handleCopy = () => {
    if (tree.pickup_code) {
      navigator.clipboard.writeText(tree.pickup_code).then(() => {
        toast.success(t('common.copied', 'Copied!'));
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      {/* Header */}
      <div className="pt-8 pb-4 text-center">
        <div className="text-6xl mb-3">🎉</div>
        <h1 className="text-2xl font-bold text-foreground">
          {t('giftTree.congratulations', 'Congratulations!')}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t('giftTree.treeCompleted', 'Your tree has grown to full!')}
        </p>
      </div>

      {/* Gift info card */}
      <div className="mx-4 bg-white rounded-2xl shadow-lg overflow-hidden border border-primary/20">
        {/* Gift image */}
        <div className="bg-gradient-to-b from-primary-light/30 to-white p-6 flex justify-center">
          {giftItem?.image_url ? (
            <img
              src={giftItem.image_url}
              alt={giftName}
              className="w-32 h-32 object-contain rounded-xl"
            />
          ) : (
            <div className="w-32 h-32 bg-primary-light/30 rounded-xl flex items-center justify-center text-5xl">
              🎁
            </div>
          )}
        </div>

        {/* Gift details */}
        <div className="p-5 text-center">
          <h2 className="text-lg font-bold text-foreground mb-1">{giftName}</h2>

          {tree.status === 'CLAIMED' ? (
            <div className="mt-4 bg-success/10 text-success rounded-xl p-4">
              <span className="text-2xl block mb-2">✅</span>
              <p className="font-semibold">
                {t('giftTree.alreadyClaimed', 'Gift Already Claimed')}
              </p>
              {tree.claimed_at && (
                <p className="text-xs mt-1 opacity-80">
                  {new Date(tree.claimed_at).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Pickup code */}
              <div className="mt-4 bg-primary-light/20 rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-2">
                  {t('giftTree.pickupCode', 'Pickup Code')}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-3xl font-mono font-bold text-primary tracking-widest">
                    {tree.pickup_code}
                  </span>
                  <button
                    onClick={handleCopy}
                    className="p-2 rounded-lg bg-white shadow-sm active:scale-95 transition-transform"
                  >
                    📋
                  </button>
                </div>
              </div>

              {/* Expiry */}
              {expiresAt && (
                <p className="text-xs text-muted-foreground mt-3">
                  {t('giftTree.expiresAt', 'Valid until')}: {expiresAt}
                </p>
              )}

              {/* Instructions */}
              <div className="mt-4 text-left bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-foreground mb-2">
                  {t('giftTree.howToPickup', 'How to pick up:')}
                </p>
                <ol className="text-xs text-muted-foreground space-y-1.5">
                  <li>1. {t('giftTree.step1', 'Go to your nearest DODO pickup point')}</li>
                  <li>2. {t('giftTree.step2', 'Show this pickup code to staff')}</li>
                  <li>3. {t('giftTree.step3', 'Receive your gift!')}</li>
                </ol>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 mt-6 pb-8 space-y-3">
        {tree.status === 'COMPLETED' && (
          <button
            onClick={() => navigate('/gift-tree')}
            className="w-full bg-accent text-white font-semibold py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {t('giftTree.backToTree', 'Back to Tree')}
          </button>
        )}
        {tree.status === 'CLAIMED' && (
          <button
            onClick={() => navigate('/gift-tree/select')}
            className="w-full bg-accent text-white font-semibold py-3 rounded-xl active:scale-[0.98] transition-all"
          >
            {t('giftTree.startNewTree', 'Start a New Tree')}
          </button>
        )}
        <button
          onClick={() => navigate('/')}
          className="w-full bg-white text-foreground font-medium py-3 rounded-xl border border-gray-200 active:scale-[0.98] transition-all"
        >
          {t('common.backToHome', 'Back to Home')}
        </button>
      </div>
    </div>
  );
};

export default CompletionPage;
