export interface ContainerConfig {
  LDAP_URI: string,
  LDAP_BIND_DN: string,
  LDAP_BIND_DN_PASSWORD: string,
  LDAP_BASE_DN: string,
  LDAP_FILTER: string,
  SOGO_LDAP_FILTER: string,
  LDAP_GC_URI: string,
  LDAP_DOMAIN: string,
  API_HOST: string,
  API_KEY: string,
  MAX_INACTIVE_COUNT: string,
  MAX_LDAP_RETRY_COUNT: string,
  DB_PASSWORD: string,
  DOVEADM_API_KEY: string,
  DOVEADM_API_HOST: string
}

export interface UserDataDB {
  exists: boolean
  isActive: ActiveUserSetting
  inactiveCount: number
}

export interface UserDataAPI {
  exists: boolean,
  isActive: number,
  displayName?: string,
}

export interface LDAPResults {
  mail: string
  displayName: string
  userAccountControl: number
  mailPermRO: string
  mailPermRW: string
  mailPermROInbox: string
  mailPermROSent: string
  mailPermSOB: string
  memberFlattened: string[]
}

export enum MailcowPermissions {
  mailPermRO = 'mailPermRO',
  mailPermRW = 'mailPermRW',
  mailPermROInbox = 'mailPermROInbox',
  mailPermROSent = 'mailPermROSent',
  mailPermSOB = 'mailPermSOB',
}

export type ActiveUserSetting = 0 | 1 | 2;

export interface ACLResults {
  newUsers: string[];
  removedUsers: string[];
}

export type DoveadmResponseExchange = [DoveadmResponseData];
export type DoveadmResponseData = [string, DoveadmExchangeResult[], string];

export type DoveadmRequestExchanges = DoveadmRequestExchange[];
export type DoveadmRequestExchange = DoveadmRequestData[];
export type DoveadmRequestData = [string, DoveadmExchangeResult, string];

export interface DoveadmExchangeResult {
  mailbox: string
  user: string
  id: string
  right?: DoveadmRights[]
}

export enum DoveadmRights {
  admin = 'admin',
  lookup = 'lookup',
  read = 'read',
  write = 'write',
  write_seen = 'write-seen',
  write_deleted = 'write-deleted',
  insert = 'insert',
  post = 'post',
  expunge = 'expunge',
  create = 'create',
  delete = 'delete',
}

export interface Forward {
  forwardAddress: any[];
}

export interface SOGoCalendarCategoriesColors {
  Miscellaneous: string;
  Personal: string;
  Customer: string;
  Gifts: string;
  Business: string;
  Status: string;
  Anniversary: string;
  Vacation: string;
  Travel: string;
  Clients: string;
  Competition: string;
  Favorites: string;
  Calls: string;
  PublicHoliday: string;
  Issues: string;
  Meeting: string;
  Projects: string;
  Holidays: string;
  Ideas: string;
  Birthday: string;
  Suppliers: string;
  Followup: string;
}

export interface SOGoMailIdentity {
  isDefault?: number;
  email: string;
  fullName: string;
  signature: string;
  replyTo: string;
}

export interface Vacation {
  daysBetweenResponse: number;
  autoReplyEmailAddresses: string[];
  days: any[];
}

export interface Defaults {
  SOGoCalendarCategoriesColors: SOGoCalendarCategoriesColors;
  SOGoGravatarEnabled: number;
  LocaleCode: string;
  SOGoMailComposeFontSize: number;
  SOGoMailReceiptNonRecipientAction: string;
  SOGoDayStartTime: string;
  SOGoAlternateAvatar: string;
  SOGoLoginModule: string;
  SOGoLDAPGroupExpansionEnabled: number;
  SOGoCalendarCategories: string[];
  SOGoTOTPEnabled: number;
  emailSeparatorKeys: number[];
  SOGoDayEndTime: string;
  SOGoMailComposeMessageType: string;
  SOGoCalendarWeekdays: string[];
  hasActiveExternalSieveScripts: number;
  SOGoShortDateFormat: string;
  SOGoMailSignaturePlacement: string;
  SOGoMailMessageForwarding: string;
  ckLocaleCode: string;
  SOGoMailReceiptOutsideDomainAction: string;
  Forward: Forward;
  SOGoTimeZone: string;
  SOGoMailReceiptAllow: string;
  UserTimeZoneSecondsFromGMT: number;
  SOGoMailComposeWindow: string;
  SOGoTimeFormat: string;
  Vacation: Vacation;
  SOGoRememberLastModule: number;
  SOGoCalendarTasksDefaultClassification: string;
  SOGoPasswordRecoveryMode: string;
  SOGoRefreshViewCheck: string;
  SOGoCalendarDefaultReminder: string;
  SOGoMailAutoSave: number;
  SOGoMailLabelsColors: { [key: string]: string[] };
  SOGoLongDateFormat: string;
  SOGoMailReceiptAnyAction: string;
  SOGoMailAutoMarkAsReadDelay: number;
  SOGoDefaultCalendar: string;
  SOGoMailReplyPlacement: string;
  SOGoAppointmentSendEMailNotifications: number;
  SOGoFirstWeekOfYear: string;
  SOGoSelectedAddressBook: string;
  SOGoCalendarEventsDefaultClassification: string;
  SOGoAnimationMode: string;
  SOGoPasswordRecoveryQuestion: string;
  SOGoMailAddOutgoingAddresses: number;
  AuxiliaryMailAccounts: any[];
  SOGoFirstDayOfWeek: number;
  SOGoLanguage: string;
  SOGoContactsCategories: string[];
  SOGoMailIdentities: SOGoMailIdentity[];
  SOGoMailDisplayRemoteInlineImages: string;
}