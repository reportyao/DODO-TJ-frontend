/**
 * 希望之树 - 好友助力页面
 *
 * 当用户通过分享链接进入时，展示好友的树并提供助力按钮。
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useHelpFriend } from '../hooks/useGiftTree';

const GiftTreeHelpPage: React.FC = () => {
  const { ownerId } = useParams<{ ownerId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const helpFriend = useHelpFriend();
  const [helped, setHelped] = useState(false);

  const handleHelp = async () => {
    if (!ownerId || helpFriend.isPending || helped) return;
    try {
      const result = await helpFriend.mutateAsync({ treeOwnerId: ownerId });
      if (result.success) {
        setHelped(true);
        toast.success(
          t('giftTree.helpSuccess', 'You helped water the tree! +{{water}} drops', {
            water: result.water_earned,
          }),
          { duration: 3000 }
        );
      } else if (result.duplicate) {
        toast(t('giftTree.alreadyHelped', 'You already helped this tree today'), {
          icon: '⚠️',
        });
        setHelped(true);
      }
    } catch (err: any) {
      toast.error(err?.message || t('common.error', 'Error'));
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF8F0] flex flex-col items-center justify-center p-6">
      {/* Tree illustration */}
      <div className="text-8xl mb-4 animate-pulse">🌳</div>

      <h1 className="text-2xl font-bold text-foreground text-center mb-2">
        {t('giftTree.helpTitle', 'Help Water the Tree!')}
      </h1>

      <p className="text-muted-foreground text-sm text-center mb-8 max-w-xs">
        {t(
          'giftTree.helpDesc',
          'Your friend is growing a Hope Tree on DODO. Tap below to help water it!'
        )}
      </p>

      {helped ? (
        <div className="text-center">
          <div className="text-5xl mb-3">💧✨</div>
          <p className="text-accent font-semibold">
            {t('giftTree.helpThanks', 'Thank you for helping!')}
          </p>
          <button
            onClick={() => navigate('/gift-tree')}
            className="mt-6 bg-accent text-white px-6 py-3 rounded-xl font-semibold"
          >
            {t('giftTree.growYourOwn', 'Grow Your Own Tree')}
          </button>
        </div>
      ) : (
        <button
          onClick={handleHelp}
          disabled={helpFriend.isPending}
          className="bg-accent text-white px-8 py-3.5 rounded-2xl font-bold text-base flex items-center gap-2 shadow-lg shadow-accent/20 active:scale-95 transition-all disabled:opacity-60"
        >
          <span className="text-xl">💧</span>
          {helpFriend.isPending
            ? t('common.loading', 'Loading...')
            : t('giftTree.helpButton', 'Water the Tree')}
        </button>
      )}

      {/* Back link */}
      <button
        onClick={() => navigate('/')}
        className="mt-8 text-muted-foreground text-sm underline"
      >
        {t('common.backToHome', 'Back to Home')}
      </button>
    </div>
  );
};

export default GiftTreeHelpPage;
