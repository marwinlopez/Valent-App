import { google, type sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';

export interface SheetsClientConfig {
  clientEmail: string;
  privateKey: string;
}

export class SheetsClient {
  private api: sheets_v4.Sheets;

  constructor(config: SheetsClientConfig) {
    const auth = new JWT({
      email: config.clientEmail,
      key: config.privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.api = google.sheets({ version: 'v4', auth });
  }

  async getValues(spreadsheetId: string, range: string): Promise<string[][]> {
    const res = await this.api.spreadsheets.values.get({ spreadsheetId, range });
    return (res.data.values as string[][]) ?? [];
  }

  async appendRow(spreadsheetId: string, range: string, row: (string | number)[]): Promise<void> {
    await this.api.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }

  async updateRow(spreadsheetId: string, range: string, row: (string | number)[]): Promise<void> {
    await this.api.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }
}
