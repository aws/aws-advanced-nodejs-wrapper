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
import { SessionState } from "./session_state";
import { PluginService } from "./plugin_service";
import { AwsWrapperError, UnsupportedMethodError } from "./utils/errors";
import { logger } from "../logutils";
import { SessionStateTransferHandler } from "./session_state_transfer_handler";

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

    if (this.sessionState.autoCommit.value !== undefined) {
      this.sessionState.autoCommit.resetPristineValue();
      this.setupPristineAutoCommit();
      try {
        await newClient.setAutoCommit(this.sessionState.autoCommit.value);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
      }
    }

    if (this.sessionState.readOnly.value !== undefined) {
      this.sessionState.readOnly.resetPristineValue();
      this.setupPristineReadOnly();
      try {
        logger.debug("SessionStateServiceImpl::applyCurrentSessionState");
        await newClient.updateSessionStateReadOnly(this.sessionState.readOnly.value);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
      }
    }

    if (this.sessionState.catalog.value !== undefined) {
      this.sessionState.catalog.resetPristineValue();
      this.setupPristineCatalog();
      try {
        await newClient.setCatalog(this.sessionState.catalog.value);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
      }
    }

    if (this.sessionState.schema.value !== undefined) {
      this.sessionState.schema.resetPristineValue();
      this.setupPristineSchema();
      try {
        await newClient.setSchema(this.sessionState.schema.value);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
      }
    }

    if (this.sessionState.transactionIsolation.value !== undefined) {
      this.sessionState.transactionIsolation.resetPristineValue();
      this.setupPristineTransactionIsolation();
      try {
        await newClient.setTransactionIsolation(this.sessionState.transactionIsolation.value);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
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

    if (this.copySessionState?.autoCommit.canRestorePristine() && this.copySessionState?.autoCommit.pristineValue !== undefined) {
      try {
        await client.setAutoCommit(this.copySessionState?.autoCommit.pristineValue);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
      }
    }

    if (this.copySessionState?.readOnly.canRestorePristine() && this.copySessionState?.readOnly.pristineValue !== undefined) {
      try {
        await client.updateSessionStateReadOnly(this.copySessionState?.readOnly.pristineValue);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
      }
    }

    if (this.copySessionState?.catalog.canRestorePristine() && this.copySessionState?.catalog.pristineValue !== undefined) {
      try {
        await client.setCatalog(this.copySessionState?.catalog.pristineValue);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
      }
    }

    if (this.copySessionState?.schema.canRestorePristine() && this.copySessionState?.schema.pristineValue !== undefined) {
      try {
        await client.setSchema(this.copySessionState?.schema.pristineValue);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
      }
    }

    if (this.copySessionState?.transactionIsolation.canRestorePristine() && this.copySessionState?.transactionIsolation.pristineValue !== undefined) {
      try {
        await client.setTransactionIsolation(this.copySessionState?.transactionIsolation.pristineValue);
      } catch (error: any) {
        if (error instanceof UnsupportedMethodError) {
          // ignore
        }
        throw error;
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
    if (!this.resetStateEnabledSetting()) {
      return;
    }

    if (this.sessionState.autoCommit.pristineValue !== undefined) {
      return;
    }

    if (autoCommit !== undefined) {
      this.sessionState.autoCommit.pristineValue = autoCommit;
    } else {
      this.sessionState.autoCommit.pristineValue = this.pluginService.getCurrentClient().getAutoCommit();
    }
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

  setupPristineCatalog(): string | undefined;
  setupPristineCatalog(catalog: string): string | undefined;
  setupPristineCatalog(catalog?: string): string | undefined {
    if (!this.resetStateEnabledSetting()) {
      return;
    }

    if (this.sessionState.catalog.pristineValue !== undefined) {
      return;
    }

    if (catalog !== undefined) {
      this.sessionState.catalog.pristineValue = catalog;
    } else {
      this.sessionState.catalog.pristineValue = this.pluginService.getCurrentClient().getCatalog();
    }
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

  setupPristineReadOnly(): boolean | undefined;
  setupPristineReadOnly(readOnly: boolean): boolean | undefined;
  setupPristineReadOnly(readOnly?: boolean): boolean | undefined {
    if (!this.resetStateEnabledSetting()) {
      return;
    }

    if (this.sessionState.readOnly.pristineValue !== undefined) {
      return;
    }

    if (readOnly !== undefined) {
      this.sessionState.readOnly.pristineValue = readOnly;
    } else {
      this.sessionState.readOnly.pristineValue = this.pluginService.getCurrentClient().isReadOnly();
    }
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

  setupPristineSchema(): string | undefined;
  setupPristineSchema(schema: string): string | undefined;
  setupPristineSchema(schema?: string): string | undefined {
    if (!this.resetStateEnabledSetting()) {
      return;
    }

    if (this.sessionState.schema.pristineValue !== undefined) {
      return;
    }

    if (schema !== undefined) {
      this.sessionState.schema.pristineValue = schema;
    } else {
      this.sessionState.schema.pristineValue = this.pluginService.getCurrentClient().getSchema();
    }
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

  setupPristineTransactionIsolation(): number | undefined;
  setupPristineTransactionIsolation(transactionIsolation: number): number | undefined;
  setupPristineTransactionIsolation(transactionIsolation?: number): number | undefined {
    if (!this.resetStateEnabledSetting()) {
      return;
    }

    if (this.sessionState.transactionIsolation.pristineValue !== undefined) {
      return;
    }

    if (transactionIsolation !== undefined) {
      this.sessionState.transactionIsolation.pristineValue = transactionIsolation;
    } else {
      this.sessionState.transactionIsolation.pristineValue = this.pluginService.getCurrentClient().getTransactionIsolation();
    }
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
