﻿import fs, { PathLike } from 'fs';
import path from 'path';
import { Client } from 'ldapts';
import { replaceInFile } from 'replace-in-file';
import { BaseBccMap } from 'ts-mailcow-api/dist/types';
import { AxiosError } from 'axios';
import {
  updateLocalUserActivity,
  createLocalUser,
  getLocalUser,
  editLocalUserPermissions,
  getUpdateSOBLocalUsers,
  getUncheckedLocalActiveUsers,
  initializeLocalUserDatabase,
  getLocalUserPermissionsChanges,
  editLocalUserDisplayName,
  saveUser,
} from './localUserDatabase';
import {
  createMailcowUser,
  getMailcowUser,
  editMailcowUser,
  initializeMailcowAPI,
  getAllBccMaps,
  addBccMap,
} from './mailcowAPI';
import {
  ChangedUsers,
  ActiveUserSetting,
  ContainerConfig,
  ActiveDirectoryUser,
  ActiveDirectoryPermissions,
  MailcowUserData,
  LocalUserData,
} from './types';
import { initializeDovecotAPI, setDovecotPermissions } from './dovecotAPI';
import { initializeMailcowDatabase } from './mailcowDatabase';
import { AliasDictionary, getAliasDictionary } from './aliasSync';
import { Users } from './entities/User';

export const containerConfig: ContainerConfig = {
  LDAP_URI: '',
  LDAP_BIND_DN: '',
  LDAP_BIND_DN_PASSWORD: '',
  LDAP_BASE_DN: '',
  LDAP_FILTER: '(&(objectClass=user)(objectCategory=person))',
  SOGO_LDAP_FILTER: "objectClass='user' AND objectCategory='person'",
  LDAP_GC_URI: '',
  LDAP_DOMAIN: '',
  API_HOST: '',
  API_KEY: '',
  MAX_INACTIVE_COUNT: '',
  MAX_LDAP_RETRY_COUNT: '',
  DB_PASSWORD: '',
  DOVEADM_API_KEY: '',
  DOVEADM_API_HOST: '',
};
export const sessionTime: number = new Date().getTime();
const consoleLogLine: string = '-'.repeat(40);

let activeDirectoryConnector: Client;
let activeDirectoryUsers: ActiveDirectoryUser[] = [];
let aliasDictionary: AliasDictionary | null = null;
let BccMaps: BaseBccMap[] | null = null;

/**
 * Search active directory users on mail and return display name
 * @param mail - mail to search for in Active Directory
 */
export async function getActiveDirectoryDisplayName(mail: string): Promise<string> {
  const activeDirectoryUser: ActiveDirectoryUser[] = (
    await activeDirectoryConnector.search(containerConfig.LDAP_BASE_DN, {
      scope: 'sub',
      filter: `(&(objectClass=user)(objectCategory=person)(mail=${mail})`,
      attributes: ['displayName'],
    })
  ).searchEntries as unknown as ActiveDirectoryUser[];

  // There should only be one resulting entry
  return activeDirectoryUser[0].displayName;
}

/**
 * Search active directory users on DN and return their mails
 * @param users - list of DN of users of which to return their mail
 * @param skipUser - user to not return in the array of mails
 */
async function getActiveDirectoryMails(users: string[], skipUser: ActiveDirectoryUser): Promise<string[]> {
  const activeDirectoryMails: string[] = [];
  for (const user of users) {
    const activeDirectoryUser: ActiveDirectoryUser[] = (
      await activeDirectoryConnector.search(user, {
        scope: 'sub',
        attributes: ['mail'],
      })
    ).searchEntries as unknown as ActiveDirectoryUser[];

    // We do not want to set permissions for owner of the mailbox
    // There should only be one resulting entry
    if (activeDirectoryUser[0].mail != skipUser.mail) activeDirectoryMails.push(activeDirectoryUser[0].mail);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return activeDirectoryMails;
}

/**
 * Synchronize all the ACL of a user with Active Directory
 * @param activeDirectoryUser - user to sync with Active Directory
 * @param permission - specific permissions to sync on
 */
async function synchronizeUserACL(
  activeDirectoryUser: ActiveDirectoryUser,
  permission: ActiveDirectoryPermissions,
): Promise<void> {
  const activeDirectoryPermissionGroup = (
    await activeDirectoryConnector.search(activeDirectoryUser[permission], {
      scope: 'sub',
      attributes: ['memberFlattened'],
    })
  ).searchEntries[0] as unknown as ActiveDirectoryUser;

  const [changedUsers, user]: [ChangedUsers, Users] = await getLocalUserPermissionsChanges(
    activeDirectoryUser.mail,
    activeDirectoryPermissionGroup.memberFlattened,
    permission,
  );

  try {

    if (changedUsers.newUsers.length != 0) {
      changedUsers.newUsers = await getActiveDirectoryMails(changedUsers.newUsers, activeDirectoryUser);

      console.info(`User(s) ${changedUsers.newUsers.toString()} added to ${activeDirectoryUser.mail} for ${permission}`);
      await setDovecotPermissions(activeDirectoryUser.mail, changedUsers.newUsers, permission, false);
    }

    if (changedUsers.removedUsers.length != 0) {
      changedUsers.removedUsers = await getActiveDirectoryMails(changedUsers.removedUsers, activeDirectoryUser);

      console.info(
          `Removing User(s) ${changedUsers.removedUsers.toString()} from ${activeDirectoryUser.mail} for ${permission}`,
      );
      await setDovecotPermissions(activeDirectoryUser.mail, changedUsers.removedUsers, permission, true);
    }

    // Only update the local user if everything went well
    await saveUser(user);
  } catch (error) {
    throw new Error(`Ran into an issue when syncing permission ${permission} of ${activeDirectoryUser.mail}.\n\n ${error as string}`);
  }
}

/**
 * Synchronize all the SOB of a user with Active Directory
 * @param activeDirectoryGroup - group to sync with Active Directory
 */
async function synchronizeUserSOB(activeDirectoryGroup: ActiveDirectoryUser): Promise<void> {
  // Should always be one entry
  const activeDirectoryPermissionGroup: ActiveDirectoryUser[] = (
    await activeDirectoryConnector.search(activeDirectoryGroup[ActiveDirectoryPermissions.mailPermSOB], {
      scope: 'sub',
      attributes: ['memberFlattened'],
    })
  ).searchEntries as unknown as ActiveDirectoryUser[];

  // Construct list in database with DN of all committees they are in
  // Get existing list of committees, add new DN as string
  for (const members of activeDirectoryPermissionGroup) {
    // For some reason a single entry is returned as string, so turn it into an array
    if (!Array.isArray(members.memberFlattened)) members.memberFlattened = [members.memberFlattened];
    for (const member of members.memberFlattened) {
      const memberResults = (
        await activeDirectoryConnector.search(member, {
          scope: 'sub',
          attributes: ['mail'],
        })
      ).searchEntries as unknown as ActiveDirectoryUser[];
      if (aliasDictionary === null) {
        throw new Error('aliasDictionary does not exist yet');
      }
      await editLocalUserPermissions(memberResults[0].mail, [
        activeDirectoryGroup.mail,
        ...(aliasDictionary.emails[activeDirectoryGroup.mail]?.aliases ?? []),
      ]);
    }
  }
}

/**
 * Synchronize the BCC maps of a user and its aliases with Active Directory
 * @param activeDirectoryGroup - group to sync with Active Directory
 */
async function synchronizeBCCMap(activeDirectoryGroup: ActiveDirectoryUser): Promise<void> {
  for (const group of Array.from(activeDirectoryGroup.memberOfFlattened)) {
    if (!group.includes('MAIL-BCC-self')) {
      continue;
    }
    const bccMap: BaseBccMap = {
      active: 1,
      bcc_dest: activeDirectoryGroup.mail,
      local_dest: activeDirectoryGroup.mail,
      type: 'sender',
    };
    const bccMapEquals = (a: BaseBccMap, b: BaseBccMap): boolean => {
      return a.active === b.active && a.bcc_dest === b.bcc_dest && a.local_dest === b.local_dest && a.type === b.type;
    };

    if (BccMaps != null && BccMaps.some((map) => bccMapEquals(map, bccMap))) {
      // already exists
      return;
    }
    await addBccMap(bccMap);
    if (!aliasDictionary) continue;
    for (const alias of aliasDictionary.emails[activeDirectoryGroup.mail].aliases) {
      const bccMap: BaseBccMap = {
        active: 1,
        bcc_dest: alias,
        local_dest: alias,
        type: 'sender',
      };
      if (BccMaps != null && BccMaps.some((map) => bccMapEquals(map, bccMap))) {
        // already exists
        return;
      }
      await addBccMap(bccMap);
    }
  }
}

/**
 * Create config file from environment variables.
 */
function createConfigFromEnvironment(): void {
  const requiredConfigKeys: string[] = [
    'LDAP-MAILCOW_LDAP_URI',
    'LDAP-MAILCOW_LDAP_GC_URI',
    'LDAP-MAILCOW_LDAP_DOMAIN',
    'LDAP-MAILCOW_LDAP_BASE_DN',
    'LDAP-MAILCOW_LDAP_BIND_DN',
    'LDAP-MAILCOW_LDAP_BIND_DN_PASSWORD',
    'LDAP-MAILCOW_API_HOST',
    'LDAP-MAILCOW_API_KEY',
    'LDAP-MAILCOW_MAX_INACTIVE_COUNT',
    'LDAP-MAILCOW_MAX_LDAP_RETRY_COUNT',
    'LDAP-MAILCOW_DB_PASSWORD',
    'DOVEADM_API_KEY',
  ];

  for (const configKey of requiredConfigKeys) {
    if (!(configKey in process.env)) throw new Error(`Required environment value ${configKey} is not set. `);
    // Add keys to local config variable
    containerConfig[configKey.replace('LDAP-MAILCOW_', '') as keyof ContainerConfig] = process.env[configKey]!;
  }

  if ('LDAP-MAILCOW_LDAP_FILTER' in process.env && !('LDAP-MAILCOW_SOGO_LDAP_FILTER' in process.env))
    throw new Error('LDAP-MAILCOW_SOGO_LDAP_FILTER is required when you specify LDAP-MAILCOW_LDAP_FILTER');

  if ('LDAP-MAILCOW_SOGO_LDAP_FILTER' in process.env && !('LDAP-MAILCOW_LDAP_FILTER' in process.env))
    throw new Error('LDAP-MAILCOW_LDAP_FILTER is required when you specify LDAP-MAILCOW_SOGO_LDAP_FILTER');

  if ('LDAP-MAILCOW_LDAP_FILTER' in process.env) containerConfig.LDAP_FILTER = process.env['LDAP-MAILCOW_LDAP_FILTER']!;

  if ('LDAP-MAILCOW_SOGO_LDAP_FILTER' in process.env)
    containerConfig.SOGO_LDAP_FILTER = process.env['LDAP-MAILCOW_SOGO_LDAP_FILTER']!;

  console.info('Successfully created config file. \n\n');
}

/**
 * Compare, backup and save (new) config files
 * @param configPath - path to original config file
 * @param configData - data of new config file
 */
function applyConfig(configPath: PathLike, configData: string): boolean {
  if (fs.existsSync(configPath)) {
    // Read and compare original data from config with new data
    const oldConfig: string = fs.readFileSync(configPath, 'utf8');

    if (oldConfig.replace(/\s+/g, '*') === configData.replace(/\s+/g, '*')) {
      console.info(`Config file ${configPath.toString()} unchanged`);
      return false;
    }

    // Backup the data
    let backupIndex = 1;
    let backupFile = `${configPath.toString()}.ldap_mailcow_bak.000`;
    // Find free filename for backup name
    while (fs.existsSync(backupFile)) {
      let prependZeroes: string = '000' + backupIndex;
      prependZeroes = prependZeroes.substring(prependZeroes.length - 3);
      backupFile = `${configPath.toString()}.ldap_mailcow_bak.${prependZeroes}`;
      backupIndex++;
    }
    // Rename original config file to backup name
    fs.renameSync(configPath, backupFile);
    console.info(`Backed up ${configPath.toString()} to ${backupFile}`);

    // Write new config file to config file location
    if (typeof configPath === 'string') {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
    }
    fs.writeFileSync(configPath, configData);
  } else {
    console.info(`A problem occured when backing up ${configPath.toString()}`);
  }

  console.info(`Saved generated config file to ${configPath.toString()}`);
  return true;
}

/**
 * Replace all variables in template file with new configuration
 */
async function readPassDBConfig(): Promise<string> {
  await replaceInFile({
    files: './templates/dovecot/ldap/passdb.conf',
    from: ['$ldap_gc_uri', '$ldap_domain', '$ldap_base_dn', '$ldap_bind_dn', '$ldap_bind_dn_password'],
    to: [
      containerConfig.LDAP_GC_URI,
      containerConfig.LDAP_DOMAIN,
      containerConfig.LDAP_BASE_DN,
      containerConfig.LDAP_BIND_DN,
      containerConfig.LDAP_BIND_DN_PASSWORD,
    ],
  });
  return fs.readFileSync('./templates/dovecot/ldap/passdb.conf', 'utf8');
}

/**
 * Replace all variables in template file with new configuration
 */
async function readDovecotExtraConfig(): Promise<string> {
  await replaceInFile({
    files: './templates/dovecot/extra.conf',
    from: ['$doveadm_api_key'],
    to: [containerConfig.DOVEADM_API_KEY],
  });
  return fs.readFileSync('./templates/dovecot/extra.conf', 'utf8');
}

/**
 * Replace all variables in template file with new configuration
 */
async function readPListLDAP(): Promise<string> {
  console.info('Adjust plist_ldap template file');
  await replaceInFile({
    files: './templates/sogo/plist_ldap',
    from: ['$ldap_uri', '$ldap_base_dn', '$ldap_bind_dn', '$ldap_bind_dn_password', '$sogo_ldap_filter'],
    to: [
      containerConfig.LDAP_URI,
      containerConfig.LDAP_BASE_DN,
      containerConfig.LDAP_BIND_DN,
      containerConfig.LDAP_BIND_DN_PASSWORD,
      containerConfig.SOGO_LDAP_FILTER,
    ],
  });
  return fs.readFileSync('./templates/sogo/plist_ldap', 'utf8');
}

/**
 * Get all users from Active Directory
 */
async function getUserDataFromActiveDirectory(): Promise<void> {
  let retryCount: number = 0;
  const maxRetryCount: number = parseInt(containerConfig.MAX_LDAP_RETRY_COUNT);

  // Sometimes LDAP response is empty, retry in those cases
  while (activeDirectoryUsers.length === 0 && retryCount < maxRetryCount) {
    if (retryCount > 0) console.warn(`Retry number ${retryCount} to get LDAPResults`);
    retryCount++;

    activeDirectoryUsers = (
      await activeDirectoryConnector.search(containerConfig.LDAP_BASE_DN, {
        scope: 'sub',
        filter: containerConfig.LDAP_FILTER,
        attributes: [
          'mail',
          'displayName',
          'userAccountControl',
          'mailPermRO',
          'mailPermRW',
          'mailPermROInbox',
          'mailPermROSent',
          'mailPermSOB',
          'memberOfFlattened',
        ],
      })
    ).searchEntries as unknown as ActiveDirectoryUser[];
  }
  if (retryCount === maxRetryCount) throw new Error('Ran into an issue when getting users from Active Directory.');
  console.info('Successfully got all users from Active Directory. \n\n');
}

/**
 * Synchronise LDAP users with Mailcow mailboxes and users stores in local DB
 */
async function synchronizeUsersWithActiveDirectory(): Promise<void> {
  for (const activeDirectoryUser of activeDirectoryUsers) {
    try {
      if (!activeDirectoryUser.mail || activeDirectoryUser.mail.length === 0) continue;
      const mail: string = activeDirectoryUser.mail;
      const displayName: string = activeDirectoryUser.displayName;
      // Active: 0 = no incoming mail/no login, 1 = allow both, 2 = custom state: allow incoming mail/no login
      const isActive: ActiveUserSetting = (activeDirectoryUser.userAccountControl & 0b10) == 2 ? 2 : 1;

      const localUser: LocalUserData = await getLocalUser(mail);
      const mailcowUser: MailcowUserData = await getMailcowUser(mail);

      // console.info('start checking local user');

      if (!localUser.exists) {
        console.info(`Adding local user ${mail} (active: ${isActive})`);
        await createLocalUser(mail, displayName, isActive);
        localUser.exists = true;
        localUser.isActive = isActive;
      }

      if (!mailcowUser.exists) {
        console.info(`Adding Mailcow user ${mail} (active: ${isActive})`);
        await createMailcowUser(mail, displayName, isActive, 256);
        mailcowUser.exists = true;
        mailcowUser.isActive = isActive;
        mailcowUser.displayName = displayName;
      }

      if (localUser.isActive !== isActive) {
        console.info(`Set ${mail} to active state ${isActive} in local user database`);
        await updateLocalUserActivity(mail, isActive, 0);
      }

      if (mailcowUser.isActive !== isActive) {
        console.info(`Set ${mail} to active state ${isActive} in Mailcow`);
        await editMailcowUser(mail, { active: isActive });
      }

      if (mailcowUser.displayName !== displayName) {
        console.info(`Changed displayname for ${mail} to ${displayName} in Mailcow`);
        await editMailcowUser(mail, { name: displayName });
      }

      if (localUser.displayName !== displayName) {
        console.info(`Changed displayname for ${mail} to ${displayName} in local database`);
        await editLocalUserDisplayName(mail, displayName);
      }
    } catch (error) {
      console.error(`Ran into an issue when syncing user ${activeDirectoryUser.mail}. \n\n ${error as string}`);
    }
  }

  // Users that were not checked might have to be removed from mailcow
  for (const user of await getUncheckedLocalActiveUsers()) {
    try {
      const mailcowUserData: MailcowUserData = await getMailcowUser(user.email);
      const localUserData: LocalUserData = await getLocalUser(user.email);

      // We check if user has b
      const inactiveCount: number = localUserData.inactiveCount;
      const maxInactiveCount: number = parseInt(containerConfig.MAX_INACTIVE_COUNT);

      if (inactiveCount > maxInactiveCount) {
        console.info(`Deactivated user ${user.email} in local user database, not found in LDAP`);
        await updateLocalUserActivity(user.email, 0, 255);
      } else {
        console.info(`Increased inactive count to ${inactiveCount + 1} for ${user.email}`);
        await updateLocalUserActivity(user.email, 2, inactiveCount + 1);
      }

      if (mailcowUserData.isActive && localUserData.isActive === 0) {
        console.info(`Deactivated user ${user.email} in Mailcow, not found in Active Directory`);
        await editMailcowUser(user.email, { active: 0 });
      }
    } catch (error) {
      if (!(error instanceof Error)) continue;
      console.error(`Ran into an issue when checking inactivity of ${user.email}. \n\n ${error}`);
    }
  }
  console.info('Successfully synced all users with Active Directory. \n\n');
}

/**
 * Synchronize all the permissions with Active Directory
 */
async function synchronizePermissionsWithActiveDirectory(): Promise<void> {
  for (const activeDirectoryUser of activeDirectoryUsers) {
    try {
      // Check if current user has corresponding permissions
      // Sometimes, the mail considered is a personal account, but it can also be a shared mailbox
      // (in principle this does not matter though, personal mails _could_ in principle also be shared if wanted)
      if (activeDirectoryUser[ActiveDirectoryPermissions.mailPermROInbox].length != 0)
        await synchronizeUserACL(activeDirectoryUser, ActiveDirectoryPermissions.mailPermROInbox);
      if (activeDirectoryUser[ActiveDirectoryPermissions.mailPermROSent].length != 0)
        await synchronizeUserACL(activeDirectoryUser, ActiveDirectoryPermissions.mailPermROSent);
      if (activeDirectoryUser[ActiveDirectoryPermissions.mailPermRO].length != 0)
        await synchronizeUserACL(activeDirectoryUser, ActiveDirectoryPermissions.mailPermRO);
      if (activeDirectoryUser[ActiveDirectoryPermissions.mailPermRW].length != 0)
        await synchronizeUserACL(activeDirectoryUser, ActiveDirectoryPermissions.mailPermRW);
      if (activeDirectoryUser[ActiveDirectoryPermissions.mailPermSOB].length != 0)
        await synchronizeUserSOB(activeDirectoryUser);
      if (activeDirectoryUser.memberOfFlattened !== undefined) await synchronizeBCCMap(activeDirectoryUser);
    } catch (error) {
      const data = (error as AxiosError).response?.data;
      // if (!(error instanceof Error)) continue;
      console.error(
        `Ran into an issue when syncing permissions of ${activeDirectoryUser.mail}. \n\n ${error as string}\n${JSON.stringify(data)}`,
      );
    }
  }

  for (const activeDirectoryUser of await getUpdateSOBLocalUsers()) {
    try {
      const SOBs: string[] = activeDirectoryUser.mailPermSOB.split(';');
      await editMailcowUser(activeDirectoryUser.email, { sender_acl: SOBs });
      // await editUserSignatures(activeDirectoryUser, SOBs);
    } catch (error) {
      if (!(error instanceof Error)) continue;
      console.error(`Ran into an issue when syncing send on behalf of ${activeDirectoryUser.email}. \n\n ${error}`);
    }
  }

  console.info('Successfully synced all permissions with Active Directory. \n\n');
}

/**
 * Read all files, initialize all (database) connections
 */
async function initializeSync(): Promise<void> {
  console.info(consoleLogLine + '\n READING ENVIRONMENT VARIABLES  \n' + consoleLogLine);
  createConfigFromEnvironment();

  console.info(consoleLogLine + '\n SETTING UP CONNECTION WITH ACTIVE DIRECTORY\n' + consoleLogLine);
  activeDirectoryConnector = new Client({
    url: containerConfig.LDAP_URI,
  });
  console.info('Successfully connected with active directory. \n\n');

  await activeDirectoryConnector
    .bind(containerConfig.LDAP_BIND_DN, containerConfig.LDAP_BIND_DN_PASSWORD)
    .catch((error) => {
      throw new Error('Ran into an issue when connecting to Active Directory. \n\n' + error);
    });

  console.info(consoleLogLine + '\n ADJUSTING TEMPLATE FILES \n' + consoleLogLine);
  const passDBConfig: string = await readPassDBConfig().catch((error) => {
    throw new Error('Ran into an issue when reading passdb.conf. \n\n' + error);
  });

  const pListLDAP: string = await readPListLDAP().catch((error) => {
    throw new Error('Ran into an issue when reading plist_ldap. \n\n' + error);
  });

  const extraConfig: string = await readDovecotExtraConfig().catch((error) => {
    throw new Error('Ran into an issue when reading extra.conf. \n\n' + error);
  });
  console.info('Successfully adjusted all template files. \n\n');

  console.info(consoleLogLine + '\n APPLYING CONFIG FILES \n' + consoleLogLine);
  const passDBConfigChanged: boolean = applyConfig('./conf/dovecot/ldap/passdb.conf', passDBConfig);
  const extraConfigChanged: boolean = applyConfig('./conf/dovecot/extra.conf', extraConfig);
  const pListLDAPChanged: boolean = applyConfig('./conf/sogo/plist_ldap', pListLDAP);
  if (passDBConfigChanged || extraConfigChanged || pListLDAPChanged)
    console.warn('One or more config files have been changed, please restart dovecot-mailcow and sogo-mailcow.');
  console.info('Successfully applied all config files \n\n');

  console.info(consoleLogLine + '\n INITIALIZING DATABASES AND API CLIENTS \n' + consoleLogLine);
  initializeLocalUserDatabase();
  await initializeMailcowDatabase();
  initializeMailcowAPI();
  initializeDovecotAPI();
  console.info('Successfully initialized all databases and API clients \n\n');

  console.info(consoleLogLine + '\nGETTING USERS FROM ACTIVE DIRECTORY\n' + consoleLogLine);
  await getUserDataFromActiveDirectory();

  console.info(consoleLogLine + '\n SYNCING ALL USERS \n' + consoleLogLine);
  await synchronizeUsersWithActiveDirectory();

  console.info(consoleLogLine + '\n SYNCING ALL PERMISSIONS \n' + consoleLogLine);
  // Get the alias dictionary if it does not yes exist, or if it is older than one hour
  if (aliasDictionary === null || (Date.now() - aliasDictionary.last_update_time.getTime()) / 3600000 > 1) {
    aliasDictionary = await getAliasDictionary();
  }
  BccMaps = (await getAllBccMaps()).map(
    (item) =>
      ({
        active: item.active,
        bcc_dest: item.bcc_dest,
        local_dest: item.local_dest,
        type: item.type,
      }) as BaseBccMap,
  );
  await synchronizePermissionsWithActiveDirectory();
}

/**
 * Start sync
 */
void initializeSync().then(() => console.info('Finished!'));
