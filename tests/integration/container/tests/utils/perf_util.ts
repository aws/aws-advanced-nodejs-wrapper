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

import { DriverHelper } from "./driver_helper";
import { TestEnvironment } from "./test_environment";
import * as XLSX from "xlsx";
import { PerfStat } from "./perf_stat";
import * as fs from "node:fs";

export class PerfTestUtility {
  static initDefaultConfig(env: TestEnvironment, host: string, port: number): any {
    let config: any = {
      user: env.databaseInfo.username,
      host: host,
      database: env.databaseInfo.default_db_name,
      password: env.databaseInfo.password,
      port: port,
      plugins: "connectTime,executeTime"
    };
    config = DriverHelper.addDriverSpecificConfiguration(config, env.engine, true);
    return config;
  }

  static async connectWithRetry(client: any): Promise<void> {
    let connectCount = 0;
    let clientConnected = false;
    while (!clientConnected && connectCount < 10) {
      try {
        await client.connect();
        clientConnected = true;
      } catch (error: any) {
        // ignore
        connectCount++;
      }
    }

    expect(clientConnected).toBe(true);
  }

  static writePerfDataToFile(data: PerfStat[], fileName: string, worksheetName: string) {
    const rows = [];
    for (let i = 0; i < data.length; i++) {
      rows.push(data[i].writeData());
    }

    const filePath = __dirname + "/../../reports/" + fileName;
    let workbook;
    if (fs.existsSync(filePath)) {
      workbook = XLSX.readFile(filePath);
    } else {
      workbook = XLSX.utils.book_new();
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    if (!workbook.Sheets[worksheetName]) {
      XLSX.utils.book_append_sheet(workbook, worksheet, worksheetName);
    }
    XLSX.utils.sheet_add_aoa(worksheet, data[0].writeHeader(), { origin: "A1" });
    XLSX.writeFile(workbook, filePath);
  }
}
