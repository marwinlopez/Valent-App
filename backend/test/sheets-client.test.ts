import { describe, it, expect, vi, beforeEach } from 'vitest';

const valuesGet = vi.fn();
const valuesAppend = vi.fn();
const valuesUpdate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    sheets: () => ({
      spreadsheets: {
        values: {
          get: valuesGet,
          append: valuesAppend,
          update: valuesUpdate,
        },
      },
    }),
  },
}));

vi.mock('google-auth-library', () => ({
  JWT: class {
    constructor(_opts: unknown) {}
  },
}));

const { SheetsClient } = await import('../src/sheets/client');

describe('SheetsClient', () => {
  beforeEach(() => {
    valuesGet.mockReset();
    valuesAppend.mockReset();
    valuesUpdate.mockReset();
  });

  it('getValues returns the rows from the API response', async () => {
    valuesGet.mockResolvedValue({ data: { values: [['a', 'b'], ['c', 'd']] } });
    const client = new SheetsClient({ clientEmail: 'x@example.com', privateKey: 'key' });
    const rows = await client.getValues('sheet-1', 'Productos!A2:Z');
    expect(rows).toEqual([['a', 'b'], ['c', 'd']]);
    expect(valuesGet).toHaveBeenCalledWith({ spreadsheetId: 'sheet-1', range: 'Productos!A2:Z' });
  });

  it('getValues returns an empty array when there are no values', async () => {
    valuesGet.mockResolvedValue({ data: {} });
    const client = new SheetsClient({ clientEmail: 'x@example.com', privateKey: 'key' });
    const rows = await client.getValues('sheet-1', 'Productos!A2:Z');
    expect(rows).toEqual([]);
  });

  it('appendRow calls the append API with USER_ENTERED input', async () => {
    valuesAppend.mockResolvedValue({});
    const client = new SheetsClient({ clientEmail: 'x@example.com', privateKey: 'key' });
    await client.appendRow('sheet-1', 'Productos!A:I', ['123', 'Leche']);
    expect(valuesAppend).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      range: 'Productos!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['123', 'Leche']] },
    });
  });
});
