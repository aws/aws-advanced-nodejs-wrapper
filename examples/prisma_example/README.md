# Tutorial: Getting Started with the AWS Advanced NodeJS Wrapper and Prisma ORM.

In this tutorial, you will set up a Prisma application with the AWS Advanced NodeJS Wrapper, and use the Prisma client to execute a simple database operation.

> [!NOTE]
> This tutorial was written for a PostgreSQL datasource using the following technologies:
>
> - Prisma 6.0.1
> - AWS Advanced NodeJS Driver 1.0.0
> - node-postgres 8.13.1
> - TypeScript 5.6.2
> - Node 22.9.0

You will progress through the following sections:

1. Set up a Prisma project
2. Add the required dependencies
3. Generate the data model
4. Set up the database adapter
5. Query the database

## Step 1: Set up a Prisma Project

To set up a Prisma project:

- Initialize a new project: `pnpm init`.
- Install typescript: `pnpm install typescript ts-node @types/node --save-dev`.
- Install Prisma: `pnpm install prisma --save-dev`.
- Install tsx: `pnpm install tsx --save-dev`
- Initialize Prisma: `npx prisma init --datasource-provider postgresql`
- Download and add the `adapter` directory from this tutorial.

Your Prisma project should have the following project hierarchy:

```
├───.env
├───package.json
├───adapter
│     │───conversion.ts
│     │───index.ts
│     └───pgaws.ts
├───prisma
│     └───schema.prisma
└───src
      └───src
          └───index.ts
```

> [!NOTE]
> The adapter directory will contain all the files that you will need in Step 4. For simplicity, the diagram above only shows the files that either need to be added or require modifications.

## Step 2: Add the required dependencies

You can use `pnpm install` to obtain the following dependencies after adding to the application's `package.json` file:

```json
{
  "dependencies": {
    "@prisma/client": "6.0.0",
    "@prisma/driver-adapter-utils": "^6.0.1",
    "aws-advanced-nodejs-wrapper": "^1.0.0",
    "pg": "^8.13.1",
    "util": "^0.12.5"
  }
}
```

## Step 3: Generate the data model.

First edit `DATABASE_URL` in the `.env` file to be the connection string to your datasource. The `DATABASE_URL` will only be used in this step, afterward you will create an AwsPgClient object and connect with the parameters specified in the client configuration.

The data model can either be generated by reading it out from an existing database or by manually creating it. When it is manually created, it can be transferred to the database using [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate/getting-started).

### Read it out from an existing database:

- Remove any existing prisma/migrations directory, models from the Prisma schema file and migrations from the database
- Run: `npx prisma db pull`.

### Manually create a data model

- Edit the `schema.prisma` file inside the `prisma` directory
  - An example can be found in [`prisma/schema.prisma`](./prisma/schema.prisma) in this tutorial.
- Write the data model to your database run: `npx prisma migrate dev --name init`.

You should see the data model in the `prisma` directory.

## Step 4: Set up the database adapter

Set up an AwsPgClient that connects to your database instance. Details can be found in [Using the AWS Advanced NodeJS Wrapper](./../../docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md).

To configure Prisma to use the datasource specified in the AwsPgClient, you will need a [driver adapter](https://www.prisma.io/docs/orm/overview/databases/database-drivers). Under the adapter directory of this tutorial is a partially implemented adapter that supports simple queries.

> [!NOTE]
> This adapter is modeled after Prisma's [adapter-pg](https://github.com/prisma/prisma/tree/main/packages/adapter-pg). For full functionality, the adapter files in this tutorial may need to be adjusted or customized.

Since driver adapters are currently in Preview, you need to enable its feature flag on the datasource block in your Prisma schema:

```schema.prisma
// schema.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}
```

Once you have added the feature flag to your schema, re-generate Prisma Client: `npx prisma generate`.

Finally, when you instantiate your Prisma Client, you need to pass an instance of the driver adapter to the PrismaClient constructor:

```ts
// src/index.ts
import { AwsPGClient } from "aws-advanced-nodejs-wrapper/dist/pg/lib/index.js";
import { PrismaAws } from "../adapter";
import { PrismaClient } from "@prisma/client";

const client = new AwsPGClient({
  user: "username",
  password: "password",
  host: "db-identifier.XYZ.us-east-2.rds.amazonaws.com",
  database: "postgres",
  port: 5432
});
const adapter = new PrismaAws(client);
const prisma = new PrismaClient({ adapter });
```

## Step 5: Query the database

You can query your datasource using the following code:

```ts
async function main() {
  await client.connect();

  const result = await prisma.schema.findFirst();
  console.log(result);

  await client.end();
}

main();
```

The `client` is the AwsPgClient, and `prisma` the Prisma Client created in Step 3. You can now use the Prisma Client to make queries through the AwsPgClient via the adapter created in Step 3.

Run the code with: `npx tsx src/index.ts`

# Summary

This tutorial walks through the steps required to add and configure the AWS Advanced NodeJS Wrapper to a simple Prisma application.