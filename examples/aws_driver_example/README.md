# Running The AWS Advanced NodeJS Wrapper Code Samples

### Prerequisites

- [npm](https://www.npmjs.com/) 9.2.0+

> [!WARNING]\
> The imports and query parsing in these samples are only compatible with AWS Advanced NodeJS Wrapper versions 2.0.0 and above.
> For instances, importing the AwsMySQLClient like so `import { AwsMySQLClient } from "../../mysql"` with Wrapper versions 1.3.0 and earlier will cause an import error.
> On the other hand, previous ways of imports such as `import { AwsMySQLClient } from "../../mysql/lib"` from version 1.3.0 will still work in version 2.0.0.
> If you are using versions 1.3.0 and earlier, see the [sample code from version 1.3.0](https://github.com/aws/aws-advanced-nodejs-wrapper/tree/1.3.0/examples/aws_driver_example).

### Running a Sample

Each code snippet in the `/examples/aws_driver_example` can be run from within the project. Each example requires existing databases or AWS resources, and will need the user to edit any credentials or user specific information for the sample to run correctly.

Prior to running a sample, all prerequisites for the sample must be met. For example, to run the `aws_iam_authentication_mysql_example.ts` file, you must have an IAM user set up and IAM Authentication must be enabled on the database you specify. See the individual [plugin pages](/docs/using-the-nodejs-wrapper/UsingTheNodejsWrapper.md#list-of-available-plugins) for more information.

Note that for any failover examples, failover will not be triggered. For example, the `aws_failover_mysql_example.ts` sample demonstrates enabling the failover plugin and failover handling, but will not initiate cluster failover on its own. For information on how to fail over an Amazon Aurora Database cluster, see [here](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-failover.html).

To run the sample:

1. Ensure all prerequisites have been met.
2. Install all required packages with `npm install`.
3. Navigate to the `/examples/aws_driver_example` directory.
4. Edit any credentials or user specific information in the desired file. For example, set the client properties in the file to match an existing database for the queries to run against.
5. Run the command `npx tsx <filename>`. For example, to run the `aws_iam_authentication_mysql_example.ts` file, the command would be `npx tsx aws_iam_authentication_mysql_example.ts`.
