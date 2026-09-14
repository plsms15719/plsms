import React from 'react';
import { ExternalLink } from 'lucide-react';

/**
 * Regex to match any standard web URL beginning with http:// or https://
 */
export const URL_REGEX = /(https?:\/\/[^\s<"'`]+)/gi;

/**
 * Punctuation characters that should not be considered part of the trailing URL
 * Includes English punctuation and the Nepali/Devanagari purna biram (।)
 */
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?)।\]}>'"\s]+$/;

/**
 * Clean a URL match by separating any trailing sentence punctuation
 */
export function cleanUrlAndTrailing(rawMatch: string): { url: string; trailing: string } {
  let url = rawMatch;
  let trailing = '';

  const match = url.match(TRAILING_PUNCTUATION_REGEX);
  if (match && match[0]) {
    trailing = match[0];
    url = url.slice(0, -trailing.length);
  }

  return { url, trailing };
}

/**
 * Extract all unique URLs starting with http:// or https:// from text
 */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX) || [];
  const urls: string[] = [];

  for (const m of matches) {
    const { url } = cleanUrlAndTrailing(m);
    if (url && !urls.includes(url)) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Returns true if the URL points to Google Drive
 */
export function isGoogleDriveUrl(url: string): boolean {
  return /drive\.google\.com/i.test(url);
}

/**
 * Generate a friendly label for an external URL
 */
export function getUrlDisplayLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('drive.google.com')) {
      return 'Google Drive File / Document';
    }
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'External Document / File';
  }
}

/**
 * Convert HTML content by turning raw unlinked http(s):// URLs into interactive hyperlinks
 */
export function linkifyHtml(htmlContent: string): string {
  if (!htmlContent) return '';

  // Match existing tags (especially <a ...>...</a>) OR raw URLs
  const tokenRegex = /(<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>)|(https?:\/\/[^\s<"'`]+)/gi;

  return htmlContent.replace(tokenRegex, (match, tag, url) => {
    // If it is already a tag (including an existing <a> anchor), leave it untouched
    if (tag) return tag;

    if (url) {
      const { url: cleanUrl, trailing } = cleanUrlAndTrailing(url);
      const isDrive = isGoogleDriveUrl(cleanUrl);
      const label = isDrive ? 'Google Drive Link' : 'Open Link';
      const displayText = isDrive
        ? 'Google Drive File / List ↗'
        : cleanUrl.length > 40
          ? `${cleanUrl.slice(0, 24)}...${cleanUrl.slice(-10)} ↗`
          : cleanUrl;

      const anchor = `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="text-[#0088cc] dark:text-[#00c0f0] font-bold underline underline-offset-4 hover:text-[#0099e6] dark:hover:text-[#38d4ff] hover:opacity-90 break-all inline-flex items-center gap-1 transition-all cursor-pointer select-text" title="${label}: ${cleanUrl}" onclick="event.stopPropagation()">${displayText}</a>`;

      return anchor + trailing;
    }

    return match;
  });
}

/**
 * Renders notice content with interactive, clickable links for any URL starting with http:// or https://
 * Preserves paragraph spacing, breaks, and optional simple HTML formatting.
 */
export function renderNoticeContentWithLinks(
  rawContent: string,
  options?: {
    textColorClass?: string;
    textSizeClass?: string;
  }
): React.ReactNode {
  if (!rawContent) return null;

  const textColor = options?.textColorClass || 'text-slate-900 dark:text-slate-200';
  const textSize = options?.textSizeClass || 'text-sm sm:text-base';

  // Check if content contains HTML tags (e.g., from rich-text actions like <span> or <mark>)
  const hasHtml = /<[a-z][\s\S]*>/i.test(rawContent);

  if (hasHtml) {
    const formattedHtml = linkifyHtml(rawContent);
    return (
      <div
        className={`${textColor} ${textSize} leading-relaxed break-words font-medium notice-rendered-content select-text`}
        dangerouslySetInnerHTML={{ __html: formattedHtml }}
      />
    );
  }

  // Pure plain text (Standard notice input, lines separated by newline)
  const paragraphs = rawContent.split('\n');

  return (
    <div className={`${textColor} ${textSize} leading-relaxed space-y-2.5 break-words font-medium select-text`}>
      {paragraphs.map((paragraph, pIdx) => {
        // Empty paragraph spacing
        if (!paragraph.trim()) {
          return <div key={pIdx} className="h-2" />;
        }

        const elements: React.ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        // Reset regex state
        URL_REGEX.lastIndex = 0;

        // Check if paragraph is purely a URL line
        const trimmed = paragraph.trim();
        const isSingleUrlLine = /^https?:\/\/[^\s<"'`]+$/i.test(trimmed);

        if (isSingleUrlLine) {
          const { url: cleanUrl, trailing } = cleanUrlAndTrailing(trimmed);
          const isDrive = isGoogleDriveUrl(cleanUrl);
          const label = isDrive ? 'Open Google Drive File / List' : `Open Link: ${getUrlDisplayLabel(cleanUrl)}`;

          return (
            <div key={pIdx} className="my-2">
              <a
                href={cleanUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-[#00c0f0]/10 border border-sky-200 dark:border-[#00c0f0]/30 text-[#0088cc] dark:text-[#00c0f0] hover:bg-sky-100 dark:hover:bg-[#00c0f0]/20 text-[11px] min-[360px]:text-xs font-bold transition-all cursor-pointer group/link max-w-full shadow-2xs"
                title={`Open: ${cleanUrl}`}
              >
                <ExternalLink className="w-3.5 h-3.5 inline-block shrink-0 opacity-80 group-hover/link:opacity-100 group-hover/link:scale-110 transition-transform" />
                <span className="truncate max-w-[220px] min-[360px]:max-w-[280px] sm:max-w-md">{label}</span>
              </a>
              {trailing && <span className="ml-1">{trailing}</span>}
            </div>
          );
        }

        while ((match = URL_REGEX.exec(paragraph)) !== null) {
          // Preceding text before URL
          if (match.index > lastIndex) {
            elements.push(paragraph.substring(lastIndex, match.index));
          }

          const { url: cleanUrl, trailing } = cleanUrlAndTrailing(match[0]);
          const isDrive = isGoogleDriveUrl(cleanUrl);
          const linkTitle = isDrive
            ? `Open Google Drive File in new tab:\n${cleanUrl}`
            : `Open Link in new tab:\n${cleanUrl}`;
          const displayLabel = isDrive
            ? 'Google Drive Link ↗'
            : cleanUrl.length > 38
              ? `${cleanUrl.slice(0, 22)}...${cleanUrl.slice(-10)} ↗`
              : cleanUrl;

          elements.push(
            <a
              key={match.index}
              href={cleanUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[#0088cc] dark:text-[#00c0f0] hover:text-[#0099e6] dark:hover:text-[#38d4ff] font-bold underline underline-offset-4 hover:opacity-90 inline-flex items-center gap-1 transition-all cursor-pointer group/url max-w-full align-baseline"
              title={linkTitle}
            >
              <span className="truncate max-w-[220px] sm:max-w-md">{displayLabel}</span>
              {!displayLabel.includes('↗') && (
                <ExternalLink className="w-3 h-3 inline-block shrink-0 opacity-75 group-hover/url:opacity-100 transition-transform" />
              )}
            </a>
          );

          if (trailing) {
            elements.push(trailing);
          }

          lastIndex = match.index + match[0].length;
        }

        // Remaining text after last URL
        if (lastIndex < paragraph.length) {
          elements.push(paragraph.substring(lastIndex));
        }

        return (
          <p key={pIdx} className="min-h-[1.25em]">
            {elements}
          </p>
        );
      })}
    </div>
  );
}
