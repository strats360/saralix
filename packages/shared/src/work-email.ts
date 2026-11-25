/**
 * Company sign-up needs a work email: personal mailboxes (Gmail, Outlook, Yahoo and the like) and
 * throwaway inboxes are refused, so each company account belongs to an organisation's domain.
 * Employees and invited admins can still use any address.
 */
export const FREE_EMAIL_DOMAINS = new Set([
  // global free mail
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "yahoo.co.uk", "ymail.com", "rocketmail.com",
  "outlook.com", "outlook.in", "hotmail.com", "hotmail.co.uk", "hotmail.co.in", "live.com", "live.in", "msn.com", "windowslive.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "aim.com", "gmx.com", "gmx.net", "gmx.de", "mail.com", "email.com", "usa.com",
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me", "tutanota.com", "tutanota.de", "tuta.io", "tuta.com",
  "zohomail.com", "zohomail.in", "zoho.com", "yandex.com", "yandex.ru", "ya.ru", "mail.ru", "inbox.com", "fastmail.com", "fastmail.fm",
  "hushmail.com", "lycos.com", "qq.com", "163.com", "126.com", "sina.com", "naver.com", "web.de", "t-online.de", "libero.it",
  // India
  "rediffmail.com", "rediff.com", "indiatimes.com", "sify.com", "in.com",
  // Gulf and others commonly seen
  "eim.ae", "emirates.net.ae",
]);

/** Throwaway inboxes. */
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "sharklasers.com", "grr.la", "10minutemail.com", "10minutemail.net",
  "tempmail.com", "temp-mail.org", "tempmail.net", "tempmailo.com", "throwawaymail.com", "yopmail.com", "yopmail.net", "trashmail.com",
  "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mintemail.com", "mohmal.com", "fakeinbox.com", "emailondeck.com",
  "mailnesia.com", "spamgourmet.com", "mytemp.email", "tempinbox.com", "burnermail.io", "moakt.com", "tmail.ws", "inboxkitten.com",
  "mailpoof.com", "trashmail.de", "discard.email", "anonaddy.me", "33mail.com", "spambox.us", "mailcatch.com", "tempr.email",
]);

export function emailDomain(email: string) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/** Why an address can't be used for company sign-up, or null when it's a work email. */
export function workEmailError(email: string): string | null {
  const d = emailDomain(email);
  if (!d) return "Enter your work email";
  // subdomains of throwaway services too (for example abc.mailinator.com)
  const parts = d.split(".");
  const suffixes = parts.map((_, i) => parts.slice(i).join("."));
  if (suffixes.some((s) => DISPOSABLE_EMAIL_DOMAINS.has(s))) return "Use your work email. Temporary inboxes can't be used to sign up.";
  if (FREE_EMAIL_DOMAINS.has(d)) return `Use your work email, like you@yourcompany.com. Personal addresses (${d}) can't be used to sign up a company.`;
  return null;
}
