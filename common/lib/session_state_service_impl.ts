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

import { WrapperProperties } from "./wrapper_property";
import { SessionStateService } from "./session_state_service";
import { AwsClient } from "./aws_client";
import { SessionState, SessionStateField } from "./session_state";
import { PluginService } from "./plugin_service";
import { AwsWrapperError, UnsupportedMethodError } from "./utils/errors";
import { logger } from "../logutils";
import { SessionStateTransferHandler } from "./session_state_transfer_handler";
import { ClientWrapper } from "./client_wrapper";

export class SessionStateServiceImpl implements SessionStateService {
  protected sessionState: SessionState;
  protected copySessionState?: SessionState;
  protected pluginService: PluginService;
  protected props: Map<string, any>;

  constructor(pluginService: PluginService, props: Map<string, any>) {
    this.pluginService = pluginService;
    this.props = props;
    this.sessionState = new SessionState();
  }

  protected transferStateEnabledSetting() {
    return WrapperProperties.TRANSFER_SESSION_STATE_ON_SWITCH.get(this.props);
  }

  protected resetStateEnabledSetting() {
    return WrapperProperties.RESET_SESSION_STATE_ON_CLOSE.get(this.props);
  }

  async applyCurrentSessionState(newClient: AwsClient): Promise<void> {
    if (!this.transferStateEnabledSetting()) {
      return;
    }

    const transferSessionStateFunc = SessionStateTransferHandler.getTransferSessionStateOnCloseFunc();
    if (transferSessionStateFunc) {
      const isHandled = transferSessionStateFunc(this.sessionState, newClient);
      if (isHandled) {
        // Custom function has handled session transfer.
        return;
      }
    }

    const targetClient: ClientWrapper = newClient.targetClient;

    // Apply current state for all 5 states: autoCommit, readOnly, catalog, schema, transactionIsolation
    for (const key of Object.keys(this.copySessionState)) {
      const state = this.copySessionState[key];
      if (state.constructor === SessionStateField) {
        await this.applyCurrentState(targetClient, state);
      }
    }
  }

  async applyPristineSessionState(client: AwsClient): Promise<void> {
    if (!this.resetStateEnabledSetting()) {
      return;
    }

    const resetSessionStateFunc = SessionStateTransferHandler.getResetSessionStateOnCloseFunc();
    if (resetSessionStateFunc) {
      const isHandled = resetSessionStateFunc(this.sessionState, client);
      if (isHandled) {
        // Custom function has handled session transfer.
        return;
      }
    }

    if (this.copySessionState === undefined) {
      return;
    }

    const targetClient: ClientWrapper = client.targetClient;

    // Set pristine states on all target client.
    // The states that will be set are: autoCommit, readonly, schema, catalog, transactionIsolation.
    for (const key of Object.keys(this.copySessionState)) {
      const state = this.copySessionState[key];
      if (state.constructor === SessionStateField) {
        await this.setPristineStateOnTarget(targetClient, state, key);
      }
    }
  }

  getAutoCommit(): boolean | undefined {
    return this.sessionState.autoCommit.value;
  }

  setAutoCommit(autoCommit: boolean): void {
    if (!this.transferStateEnabledSetting()) {
      return;
    }

    this.sessionState.autoCommit.value = autoCommit;
    this.logCurrentState();
  }

  setupPristineAutoCommit(): void;
  setupPristineAutoCommit(autoCommit: boolean): void;
  setupPristineAutoCommit(autoCommit?: boolean): void {
    return this.setupPristineState(this.sessionState.autoCommit, autoCommit);
  }

  getCatalog(): string | undefined {
    return this.sessionState.catalog.value;
  }

  setCatalog(catalog: string): void {
    if (!this.transferStateEnabledSetting()) {
      return;
    }

    this.sessionState.catalog.value = catalog;
    this.logCurrentState();
  }

  setupPristineCatalog(): void;
  setupPristineCatalog(catalog: string): void;
  setupPristineCatalog(catalog?: string): void {
    this.setupPristineState(this.sessionState.catalog, catalog);
  }

  getReadOnly(): boolean | undefined {
    return this.sessionState.readOnly.value;
  }

  setReadOnly(readOnly: boolean): void {
    if (!this.transferStateEnabledSetting()) {
      return;
    }

    this.sessionState.readOnly.value = readOnly;
    this.logCurrentState();
  }

  setupPristineReadOnly(): void;
  setupPristineReadOnly(readOnly: boolean): void;
  setupPristineReadOnly(readOnly?: boolean): void {
    this.setupPristineState(this.sessionState.readOnly, readOnly);
  }

  updateReadOnly(readOnly: boolean): void {
    // TODO: review this
    // this.pluginService.getSessionStateService().setupPristineReadOnly(readOnly);
    // this.pluginService.getSessionStateService().setReadOnly(readOnly);
    this.setupPristineState(this.sessionState.readOnly, readOnly);
    this.setState(this.sessionState.readOnly, readOnly);
  }

  getSchema(): string | undefined {
    return this.sessionState.schema.value;
  }

  setSchema(schema: string): void {
    if (!this.transferStateEnabledSetting()) {
      return;
    }

    this.sessionState.schema.value = schema;
    this.logCurrentState();
  }

  setupPristineSchema(): void;
  setupPristineSchema(schema: string): void;
  setupPristineSchema(schema?: string): void {
    this.setupPristineState(this.sessionState.schema, schema);
  }

  getTransactionIsolation(): number | undefined {
    return this.sessionState.transactionIsolation.value;
  }

  setTransactionIsolation(transactionIsolation: number): void {
    if (!this.transferStateEnabledSetting()) {
      return;
    }

    this.sessionState.transactionIsolation.value = transactionIsolation;
    this.logCurrentState();
  }

  setupPristineTransactionIsolation(): void;
  setupPristineTransactionIsolation(transactionIsolation: number): void;
  setupPristineTransactionIsolation(transactionIsolation?: number): void {
    this.setupPristineState<number>(this.sessionState.transactionIsolation, transactionIsolation);
  }

  private setState<Type>(state: any, val: Type): void {
    if (!this.transferStateEnabledSetting()) {
      return;
    }

    this.sessionState[state].value = val;
    this.logCurrentState();
  }

  private async applyCurrentState(targetClient: ClientWrapper, sessionState: SessionStateField<any>): Promise<void> {
    if (sessionState.value !== undefined) {
      sessionState.resetPristineValue();
      this.setupPristineState(sessionState);
      await this.setStateOnTarget(targetClient, sessionState);
    }
  }

  private async setStateOnTarget(targetClient: ClientWrapper, sessionStateField: SessionStateField<any>): Promise<void> {
    try {
      await targetClient.query(sessionStateField.getQuery(this.pluginService.getDialect(), false));
      SessionState.setState(sessionStateField, this.sessionState);
    } catch (error: any) {
      if (error instanceof UnsupportedMethodError) {
        // ignore
      }
      throw error;
    }
  }

  private async setPristineStateOnTarget(
    targetClient: ClientWrapper,
    sessionStateField: SessionStateField<any>,
    sessionStateName: string
  ): Promise<void> {
    if (sessionStateField.canRestorePristine() && sessionStateField.pristineValue !== undefined) {
      try {
        await targetClient.query(sessionStateField.getQuery(this.pluginService.getDialect(), true));
        this.setState(sessionStateName, sessionStateField.pristineValue);
        SessionState.setPristineState(sessionStateField, this.copySessionState);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
      }
    }
  }

  private setupPristineState<Type>(state: SessionStateField<Type>): void;
  private setupPristineState<Type>(state: SessionStateField<Type>, val: Type): void;
  private setupPristineState<Type>(state: SessionStateField<Type>, val?: Type): void {
    if (!this.resetStateEnabledSetting()) {
      return;
    }

    if (state.pristineValue !== undefined) {
      return;
    }

    state.pristineValue = val ?? state.getClientValue(this.pluginService.getCurrentClient());
  }

  begin(): void {
    this.logCurrentState();

    if (!this.transferStateEnabledSetting() && !this.resetStateEnabledSetting()) {
      return;
    }

    if (this.copySessionState) {
      throw new AwsWrapperError("Previous session state transfer is not completed.");
    }

    this.copySessionState = this.sessionState.copy();
  }

  complete(): void {
    this.copySessionState = undefined;
  }

  reset(): void {
    this.sessionState.autoCommit.reset();
    this.sessionState.readOnly.reset();
    this.sessionState.catalog.reset();
    this.sessionState.schema.reset();
    this.sessionState.transactionIsolation.reset();
  }

  logCurrentState(): void {
    logger.info("Current session state:\n" + this.sessionState.toString());
  }
}
