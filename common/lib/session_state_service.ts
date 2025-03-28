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

import { AwsClient } from "./aws_client";
import { TransactionIsolationLevel } from "./utils/transaction_isolation_level";

export interface SessionStateService {
  // auto commit
  getAutoCommit(): boolean | undefined;
  setAutoCommit(autoCommit: boolean): void;
  setupPristineAutoCommit(): void;
  setupPristineAutoCommit(autoCommit: boolean): void;

  // read only
  getReadOnly(): boolean | undefined;
  setReadOnly(readOnly: boolean): void;
  setupPristineReadOnly(): void;
  setupPristineReadOnly(readOnly: boolean): void;
  updateReadOnly(readOnly: boolean): void;

  // catalog
  getCatalog(): string | undefined;
  setCatalog(catalog: string): void;
  setupPristineCatalog(): void;
  setupPristineCatalog(catalog: string): void;

  // schema
  getSchema(): string | undefined;
  setSchema(schema: string): void;
  setupPristineSchema(): void;
  setupPristineSchema(schema: string): void;

  // transaction isolation
  getTransactionIsolation(): TransactionIsolationLevel | undefined;
  setTransactionIsolation(transactionIsolation: TransactionIsolationLevel): void;
  setupPristineTransactionIsolation(): void;
  setupPristineTransactionIsolation(transactionIsolation: TransactionIsolationLevel): void;

  reset(): void;

  // Begin session transfer process.
  begin(): void;

  // Complete session transfer process. This method should be called despite whether
  // session transfer is successful or not.
  complete(): void;

  // Apply current session state (of the current connection) to a new connection.
  applyCurrentSessionState(newClient: AwsClient): Promise<void>;

  // Apply pristine values to the provided connection (practically resetting the connection to its original state).
  applyPristineSessionState(client: AwsClient): Promise<void>;
}
