/*
  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
 
  http://www.apache.org/licenses/LICENSE-2.0
 
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { HostListProvider } from "../host_list_provider/host_list_provider";
import { HostListProviderService } from "../host_list_provider_service";
import { ClientWrapper } from "../client_wrapper";
import { FailoverRestriction } from "../plugins/failover/failover_restriction";
import { ErrorHandler } from "../error_handler";
import { TransactionIsolationLevel } from "../utils/transaction_isolation_level";
import { HostRole } from "../host_role";

export enum DatabaseType {
  MYSQL,
  POSTGRES
}

export interface DatabaseDialect {
  getDefaultPort(): number;
  getHostAliasQuery(): string;
  getHostAliasAndParseResults(targetClient: ClientWrapper): Promise<string>;
  getServerVersionQuery(): string;
  getSetReadOnlyQuery(readOnly: boolean): string;
  getSetAutoCommitQuery(autoCommit: boolean): string;
  getSetTransactionIsolationQuery(level: TransactionIsolationLevel): string;
  getSetCatalogQuery(catalog: string): string;
  getSetSchemaQuery(schema: string): string;
  getDialectUpdateCandidates(): string[];
  getErrorHandler(): ErrorHandler;
  getHostRole(targetClient: ClientWrapper): Promise<HostRole>;
  isDialect(targetClient: ClientWrapper): Promise<boolean>;
  getHostListProvider(props: Map<string, any>, originalUrl: string, hostListProviderService: HostListProviderService): HostListProvider;
  isClientValid(targetClient: ClientWrapper): Promise<boolean>;
  getDatabaseType(): DatabaseType;
  getDialectName(): string;
  getFailoverRestrictions(): FailoverRestriction[];
  doesStatementSetReadOnly(statement: string): boolean | undefined;
  doesStatementSetTransactionIsolation(statement: string): TransactionIsolationLevel | undefined;
  doesStatementSetAutoCommit(statement: string): boolean | undefined;
  doesStatementSetSchema(statement: string): string | undefined;
  doesStatementSetCatalog(statement: string): string | undefined;
}
