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

class SessionStateField<Type> {
  private _value?: Type | undefined;
  private _pristineValue?: Type | undefined;

  get value(): Type | undefined {
    return this._value;
  }

  set value(value: Type | undefined) {
    this._value = value;
  }

  get pristineValue(): Type | undefined {
    return this._pristineValue;
  }

  set pristineValue(value: Type | undefined) {
    this._pristineValue = value;
  }

  resetValue(): void {
    this._value = undefined;
  }

  resetPristineValue(): void {
    this._pristineValue = undefined;
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

  copy(): SessionStateField<Type> {
    const newField: SessionStateField<Type> = new SessionStateField();
    if (this.value !== undefined) {
      newField.value = this.value;
    }

    if (this.pristineValue !== undefined) {
      newField.pristineValue = this.pristineValue;
    }

    return newField;
  }

  toString() {
    return `${this.pristineValue ? this.pristineValue : "(blank)"} => ${this.value ? this.value : "(blank)"}`;
  }
}

export class SessionState {
  autoCommit: SessionStateField<boolean> = new SessionStateField<boolean>();
  readOnly: SessionStateField<boolean> = new SessionStateField<boolean>();
  catalog: SessionStateField<string> = new SessionStateField<string>();
  schema: SessionStateField<string> = new SessionStateField<string>();
  transactionIsolation: SessionStateField<number> = new SessionStateField<number>();

  copy(): SessionState {
    const newSessionState = new SessionState();
    newSessionState.autoCommit = this.autoCommit.copy();
    newSessionState.readOnly = this.readOnly.copy();
    newSessionState.catalog = this.catalog.copy();
    newSessionState.schema = this.schema.copy();
    newSessionState.transactionIsolation = this.transactionIsolation.copy();

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
