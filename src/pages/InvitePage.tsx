import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useUser } from "../contexts/UserContext";
import {
  UserPlusIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  UsersIcon,
  ShareIcon,
  BuildingStorefrontIcon,
  PhoneIcon,
} from "@heroicons/react/24/outline";
import { formatDateTime, copyToClipboard } from "../lib/utils";
import toast from "react-hot-toast";
import { extractEdgeFunctionError } from "../utils/edgeFunctionHelper";

interface InvitedUser {
  id: string;
  first_name: string | null;
  phone_number: string | null;
  avatar_url: string | null;
  created_at: string;
  level: number;
  total_spent: number;
  commission_earned: number;
}

const InvitePage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useUser();
  const [invitedUsers, setInvitedUsers] = useState<InvitedUser[]>([]);
  const [totalInvited, setTotalInvited] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const inviteCode = user?.referral_code || user?.invite_code || "...";
  const appDomain = import.meta.env.VITE_APP_DOMAIN || window.location.origin;
  const inviteLink = `${appDomain}/register?ref=${inviteCode}`;

  const fetchInviteData = useCallback(async () => {
    setIsLoading(true);
    try {
      const sessionToken = localStorage.getItem("custom_session_token");
      const { data, error } = await supabase.functions.invoke("get-invite-data", {
        body: { user_id: user.id, session_token: sessionToken }
      });
      if (error) throw new Error(await extractEdgeFunctionError(error));
      if (data) {
        const allUsers: InvitedUser[] = data.invited_users || [];
        const directUsers = allUsers.filter((u: InvitedUser) => u.level === 1);
        setInvitedUsers(directUsers);
        setTotalInvited(data.stats?.total_referrals || directUsers.length);
      }
    } catch (error) {
      console.error("Failed to fetch invite data:", error);
      setInvitedUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, [user, t]);

  useEffect(() => { if (user) fetchInviteData(); }, [user, fetchInviteData]);

  const copyInviteLink = async () => {
    const success = await copyToClipboard(inviteLink);
    if (success) {
      setCopied(true);
      toast.success(t("invite.linkCopied"));
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t("common.copyFailed"));
    }
  };

  const shareInvite = () => {
    const text = t("invite.shareText", { inviteCode, inviteLink });
    if (navigator.share) {
      navigator.share({ title: t("invite.shareTitle"), text, url: inviteLink }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text + "\n" + inviteLink)}`, "_blank");
    }
  };

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      <div className="bg-gradient-to-r from-primary to-primary-dark text-white px-4 py-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-3">
            <UserPlusIcon className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">{t("wholesaler.myInvite")}</h1>
          <p className="text-white/90 text-sm">{t("wholesaler.myInviteDesc")}</p>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
          <p className="text-white/80 text-sm mb-2 text-center">{t("invite.myInviteCode")}</p>
          <div className="flex items-center justify-center space-x-3 mb-4">
            <span className="text-3xl font-bold tracking-wider">{inviteCode}</span>
            <button
              onClick={() => copyToClipboard(inviteCode).then(ok => ok && toast.success(t("invite.codeCopied")))}
              className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
            >
              <ClipboardDocumentIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={copyInviteLink}
              className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-white text-primary rounded-xl font-medium hover:bg-white/90 transition-colors"
            >
              {copied ? (
                <><CheckIcon className="w-5 h-5" /><span>{t("invite.copied")}</span></>
              ) : (
                <><ClipboardDocumentIcon className="w-5 h-5" /><span>{t("invite.copyLink")}</span></>
              )}
            </button>
            <button
              onClick={shareInvite}
              className="px-4 py-3 bg-white/20 hover:bg-white/30 rounded-xl transition-colors flex items-center justify-center"
            >
              <ShareIcon className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-4 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-amber-100 rounded-lg"><UsersIcon className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{totalInvited}</p>
                <p className="text-xs text-gray-500">{t("invite.totalInvited")}</p>
              </div>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-lg"><BuildingStorefrontIcon className="w-5 h-5 text-green-600" /></div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{invitedUsers.length}</p>
                <p className="text-xs text-gray-500">{t("wholesaler.directInvited")}</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="px-4 mb-4">
        <h3 className="font-semibold text-gray-900 mb-3">{t("wholesaler.invitedMerchants")}</h3>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : invitedUsers.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center">
            <BuildingStorefrontIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-500">{t("wholesaler.noInvitedMerchants")}</p>
            <p className="text-sm text-gray-400 mt-2">{t("invite.shareToEarn")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {invitedUsers.map((invitedUser, index) => (
              <motion.div
                key={invitedUser.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-white rounded-xl p-4 shadow-sm"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white font-semibold flex-shrink-0 overflow-hidden">
                    {invitedUser.avatar_url ? (
                      <img src={invitedUser.avatar_url} alt="Avatar"
                        style={{ width: "48px", height: "48px", borderRadius: "9999px", objectFit: "cover", maxWidth: "none" }}
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : (
                      <span className="text-lg">{(invitedUser.first_name || "U").charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {invitedUser.first_name || (invitedUser.phone_number ? invitedUser.phone_number.slice(0, 3) + "****" : t("invite.anonymousUser"))}
                    </p>
                    {invitedUser.phone_number && (
                      <div className="flex items-center space-x-1 mt-0.5">
                        <PhoneIcon className="w-3 h-3 text-gray-400" />
                        <p className="text-xs text-gray-500">
                          {invitedUser.phone_number.slice(0, 4) + "****" + invitedUser.phone_number.slice(-2)}
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t("invite.registrationTime")}: {formatDateTime(invitedUser.created_at)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-primary-dark">
                      {t("wholesaler.channelMerchant")}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default InvitePage;
