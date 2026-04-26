/**
 * 通用分享工具函数
 * 
 * 优先使用 Web Share API（移动端原生分享面板），
 * 降级到复制链接到剪贴板。
 */
export async function shareContent(
  text: string,
  url: string,
  title?: string
): Promise<boolean> {
  try {
    if (navigator.share) {
      await navigator.share({
        title: title || 'DODO',
        text,
        url,
      });
      return true;
    }
  } catch (err: any) {
    // User cancelled share or share not supported
    if (err.name === 'AbortError') return false;
  }

  // Fallback: copy to clipboard
  try {
    const shareText = `${text}\n${url}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareText);
    } else {
      // Legacy fallback
      const textarea = document.createElement('textarea');
      textarea.value = shareText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    return true;
  } catch {
    return false;
  }
}
