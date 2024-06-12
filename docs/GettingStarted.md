# Getting Started

## Minimum Requirements

Before using the AWS Advanced NodeJS Wrapper, you must install:

- Node 21.0.0+
- The AWS Advanced NodeJS Wrapper.
- Your choice of underlying Node driver.
    - To use the wrapper with Aurora with PostgreSQL compatibility, install the [PostgreSQL Client](https://github.com/brianc/node-postgres).
    - To use the wrapper with Aurora with MySQL compatibility, install the [MySQL2 Client](https://github.com/sidorares/node-mysql2).

If you are using the AWS NodeJS Wrapper as part of a Node project, include the wrapper and underlying driver as dependencies.

> **Note:** Depending on which features of the AWS NodeJS Wrapper you use, you may have additional package requirements. Please refer to this [table](https://github.com/awslabs/aws-advanced-nodejs-wrapper/blob/main/docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#list-of-available-plugins) for more information.

## Obtaining the AWS NodeJS Wrapper

You can use [npm](https://www.npmjs.com/) to obtain the AWS NodeJS Wrapper by adding the following configuration to the application's `package.json` file:

```json
{
  "dependencies": {
    "aws-advanced-nodejs-wrapper": "^1.0.0"
  }
}
```

## Using the AWS NodeJS Wrapper

For more detailed information about how to use and configure the AWS NodeJS Wrapper, please visit [this page](./using-the-nodejs-wrapper/UsingTheNodejsWrapper.md).
