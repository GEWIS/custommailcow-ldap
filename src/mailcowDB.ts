// // Connection options for the DB
// import {ConnectionOptions, createConnection, getConnection} from "typeorm";
//
// const options: ConnectionOptions = {
//     type: 'mysql',
//     host: ' 172.22.1.2',
//     port: 3306,
//     username: 'mailcow',
//     password: process.env['MAILCOW-DB-PASSWORD'],
//     database: 'mailcow'
// }
//
// /**
//  * Initialize database connection. Setup database if it does not yet exist
//  */
// export async function initializeDB(): Promise<void> {
//     await createConnection(options).catch((error: never) => console.log(error));
//     await getConnection().synchronize()
//
//     console.log(await )
// }