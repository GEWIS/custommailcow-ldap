import { getAllAliases } from './mailcowAPI';

/**
 * The alias_dict is an object that maps every email to all its aliases
 * This is done in the form of:
 * {
 *     'email': ['alias1', 'alias2']
 * }
 */
export type AliasDictionary = {
  emails: {
    [key:string] : {
      aliases: string[]
    },
  }
  last_update_time: Date
};

export async function getAliasDictionary(): Promise<AliasDictionary> {
  const aliases = await getAllAliases();

  let aliasDict: AliasDictionary = {
    emails: {},
    last_update_time: new Date(),
  };

  aliases.forEach(alias => {
    if (aliasDict.emails[alias.goto]) {
      aliasDict.emails[alias.goto].aliases.push(alias.address);
    } else {
      aliasDict.emails[alias.goto] = {
        aliases: [alias.address],
      };
    }
  });
  return aliasDict;
}