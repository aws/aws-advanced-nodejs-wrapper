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

import { DatabaseDialect } from "./database_dialect/database_dialect";
import { AwsClient } from "./aws_client";
import { TransactionIsolationLevel } from "./utils/transaction_isolation_level";

export abstract class SessionStateField<Type> {
  value?: Type;
  pristineValue?: Type;

  constructor(copy?: SessionStateField<Type>) {
    if (copy) {
      this.value = copy.value;
      this.pristineValue = copy.pristineValue;
    }
  }

  abstract setValue(state: SessionState): void;

  abstract setPristineValue(state: SessionState): void;

  abstract getQuery(dialect: DatabaseDialect, isPristine: boolean): string;

  abstract getClientValue(client: AwsClient): Type;

  resetValue(): void {
    this.value = undefined;
  }

  resetPristineValue(): void {
    this.pristineValue = undefined;
  }

  reset(): void {
    this.resetValue();
    this.resetPristineValue();
  }

  isPristine(): boolean {
    // The value has never been set up so the session state has the pristine value.
    if (this.value === undefined) {
      return true;
    }

    // The pristine value isn't setup, so it's inconclusive.
    // Take the safest path.
    if (this.pristineValue === undefined) {
      return false;
    }

    return this.value === this.pristineValue;
  }

  canRestorePristine(): boolean {
    if (this.pristineValue === undefined) {
      return false;
    }

    if (this.value !== undefined) {
      // It's necessary to restore the pristine value only if the current session value is not the same as the pristine value.
      return this.value !== this.pristineValue;
    }

    // It's inconclusive if the current value is the same as pristine value, so we need to take the safest path.
    return true;
  }

  toString() {
    return `${this.pristineValue ?? "(blank)"} => ${this.value ?? "(blank)"}`;
  }
}

class AutoCommitState extends SessionStateField<boolean> {
  setValue(state: SessionState) {
    this.value = state.autoCommit.value;
  }

  setPristineValue(state: SessionState) {
    this.value = state.autoCommit.pristineValue;
  }

  getQuery(dialect: DatabaseDialect, isPristine: boolean = false) {
    return dialect.getSetAutoCommitQuery(isPristine ? this.pristineValue : this.value);
  }

  getClientValue(client: AwsClient): boolean {
    return client.getAutoCommit();
  }
}

class ReadOnlyState extends SessionStateField<boolean> {
  setValue(state: SessionState) {
    this.value = state.readOnly.value;
  }

  setPristineValue(state: SessionState) {
    this.value = state.readOnly.pristineValue;
  }

  getQuery(dialect: DatabaseDialect, isPristine: boolean = false) {
    return dialect.getSetReadOnlyQuery(this.value);
  }

  getClientValue(client: AwsClient): boolean {
    return client.isReadOnly();
  }
}

class CatalogState extends SessionStateField<string> {
  setValue(state: SessionState) {
    this.value = state.catalog.value;
  }

  setPristineValue(state: SessionState) {
    this.value = state.catalog.pristineValue;
  }

  getQuery(dialect: DatabaseDialect, isPristine: boolean = false) {
    return dialect.getSetCatalogQuery(isPristine ? this.pristineValue : this.value);
  }

  getClientValue(client: AwsClient): string {
    return client.getCatalog();
  }
}

class SchemaState extends SessionStateField<string> {
  setValue(state: SessionState) {
    this.value = state.schema.value;
  }

  setPristineValue(state: SessionState) {
    this.value = state.schema.pristineValue;
  }

  getQuery(dialect: DatabaseDialect, isPristine: boolean = false) {
    return dialect.getSetSchemaQuery(isPristine ? this.pristineValue : this.value);
  }

  getClientValue(client: AwsClient): string {
    return client.getSchema();
  }
}

class TransactionIsolationState extends SessionStateField<TransactionIsolationLevel> {
  setValue(state: SessionState) {
    this.value = state.transactionIsolation.value;
  }

  setPristineValue(state: SessionState) {
    this.value = state.transactionIsolation.pristineValue;
  }

  getQuery(dialect: DatabaseDialect, isPristine: boolean = false) {
    return dialect.getSetTransactionIsolationQuery(isPristine ? this.pristineValue : this.value);
  }

  getClientValue(client: AwsClient): number {
    return client.getTransactionIsolation();
  }
}

export class SessionState {
  autoCommit: AutoCommitState = new AutoCommitState();
  readOnly: ReadOnlyState = new ReadOnlyState();
  catalog: CatalogState = new CatalogState();
  schema: SchemaState = new SchemaState();
  transactionIsolation: TransactionIsolationState = new TransactionIsolationState();

  static setState(target: SessionStateField<any>, source: SessionState): void {
    target.setValue(source);
  }

  static setPristineState(target: SessionStateField<any>, source: SessionState): void {
    target.setPristineValue(source);
  }

  copy(): SessionState {
    const newSessionState = new SessionState();
    newSessionState.autoCommit = new AutoCommitState(this.autoCommit);
    newSessionState.readOnly = new ReadOnlyState(this.readOnly);
    newSessionState.catalog = new CatalogState(this.catalog);
    newSessionState.schema = new SchemaState(this.schema);
    newSessionState.transactionIsolation = new TransactionIsolationState(this.transactionIsolation);

    return newSessionState;
  }

  toString(): string {
    return `autoCommit: ${this.autoCommit}\n
      readOnly: ${this.readOnly}\n
      catalog: ${this.catalog}\n
      schema: ${this.schema}\n
      transactionIsolation: ${this.transactionIsolation}\n`;
  }
}
