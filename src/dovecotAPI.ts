import * as http from 'http';
import axios, { AxiosInstance } from 'axios';
import { DovecotData, DovecotRequestData, DovecotPermissions, ActiveDirectoryPermissions } from './types';
import { containerConfig } from './index';

let dovecotClient: AxiosInstance;

type DovecotMailboxResponse = [string, DovecotData[]][];

/**
 * Initialize the Dovecot API
 */
export function initializeDovecotAPI(): void {
  dovecotClient = axios.create({
    baseURL: 'http://172.22.1.250:9000/doveadm/v1',
    headers: {
      'Content-Type': 'text/plain',
      Authorization: `X-Dovecot-API ${Buffer.from(containerConfig.DOVEADM_API_KEY).toString('base64')}`,
    },
    httpAgent: new http.Agent({
      keepAlive: true,
    }),
  });
}

/**
 * Get all mailbox subfolders of a mail
 * @param mail - email to get all subfolders from
 */
async function getMailboxSubFolders(mail: string): Promise<string[]> {
  const maildata = await dovecotClient.post<DovecotMailboxResponse>('', {
    _mailboxList_: {
      _user: mail,
    },
    [`_mailboxList_${mail}_`]: '', // Use computed property syntax with square brackets
  });

  const subFolders: string[] = [];
  for (const subFolder of maildata.data[0][1]) {
    if (subFolder.mailbox.startsWith('Shared')) continue;
    subFolders.push(subFolder.mailbox);
  }

  return subFolders;
}

/**
 * Set read and write permissions in dovecot
 * @param mail - mail for which permissions should be set
 * @param users - users that will be getting permissions to the above mail
 * @param permission - permissions that will be set
 * @param removePermission - whether permissions should be removed or added
 */
export async function setDovecotPermissions(
  mail: string,
  users: string[],
  permission: ActiveDirectoryPermissions,
  removePermission: boolean,
) {
  let mailboxSubFolders: string[] = [];
  let permissionTag;

  if (permission == ActiveDirectoryPermissions.mailPermROInbox) {
    mailboxSubFolders = mailboxSubFolders.concat(['INBOX', 'Inbox']);
    permissionTag = 'PermROInbox';
  }

  if (permission == ActiveDirectoryPermissions.mailPermROSent) {
    if (permissionTag === null) {
      permissionTag = 'PermROSent';
    } else {
      permissionTag = 'PermROInboxSent';
    }
    mailboxSubFolders.push('Sent');
  }

  if (permission == ActiveDirectoryPermissions.mailPermRO || ActiveDirectoryPermissions.mailPermRW) {
    mailboxSubFolders = await getMailboxSubFolders(mail);
    permissionTag = 'PermRO';
  }

  // Dovecot API requests are very unclear and badly documented
  // The idea; you can create an array of requests and send it as one big request
  const dovecotRequests: DovecotRequestData[] = [];
  for (const subFolder of mailboxSubFolders) {
    for (const user of users) {
      let rights = [
        DovecotPermissions.lookup,
        DovecotPermissions.read,
        DovecotPermissions.write,
        DovecotPermissions.write_seen,
      ];

      if (permission === ActiveDirectoryPermissions.mailPermRW) {
        rights = rights.concat([
          DovecotPermissions.write_deleted,
          DovecotPermissions.insert,
          DovecotPermissions.post,
          DovecotPermissions.expunge,
          DovecotPermissions.create,
          DovecotPermissions.delete,
        ]);
      }

      const dovecotRequest: DovecotRequestData = [
        removePermission ? 'aclRemove' : 'aclSet',
        {
          user: mail,
          id: `user=${user}`,
          mailbox: subFolder,
          right: rights,
        },
        permission === ActiveDirectoryPermissions.mailPermRW
          ? `PermRW_${mail}_${user}`
          : `${permissionTag}_${mail}_${user}`,
      ];

      dovecotRequests.push(dovecotRequest);
    }
  }

  // There is a max size of the requests
  // Break them up in smaller pieces if necessary
  // NOTE from Dovecot docs: It is not guaranteed that requests are processed in order or that the doveadm server does not crash
  const dovecotMaxRequestSize: number = 10;
  if (dovecotRequests.length > dovecotMaxRequestSize) {
    for (let requestsDone: number = 0; requestsDone < dovecotRequests.length; requestsDone += dovecotMaxRequestSize) {
      await dovecotClient.post('', dovecotRequests.slice(requestsDone, requestsDone + dovecotMaxRequestSize));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } else {
    await dovecotClient.post('', dovecotRequests);
  }
}
