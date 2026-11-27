import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupplierPortal } from '../src/features/supplier/SupplierPortal';
import * as api from '../src/lib/api';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));

vi.mock('../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'sup-user-1',
      name: 'GCMMFL Supplier',
      role: 'SUPPLIER',
      supplier: { id: 'sup-1', name: 'GCMMFL Panchmahal', code: 'GCMMFL-PMH' },
    },
    logout: vi.fn(),
  }),
}));

vi.mock('../src/locales/translations', () => ({
  useI18n: () => ({
    lang: 'en',
    setLang: vi.fn(),
    t: (key: string) =>
      ({
        appTitle: 'KHORAK',
        navDashboard: 'Dashboard',
        navCreateDispatch: 'Create Dispatch',
        navDispatches: 'Dispatches',
        navProfile: 'Profile',
        signOut: 'Sign out',
        loading: 'Loading...',
        cancel: 'Cancel',
      }[key] ?? key),
  }),
}));

describe('SupplierPortal Create Dispatch form', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/dispatches/targets') {
        return {
          success: true,
          data: {
            centres: [
              {
                id: 'centre-1',
                name: 'Vavdi AWC',
                nameGu: null,
                code: 'AWC-GDR-01',
                location: 'Vavdi',
                sector: { name: 'Godhra', block: { name: 'Godhra' } },
              },
            ],
            products: [
              {
                id: 'prod-1',
                code: 'THR-BAL',
                name: 'Bal Shakti',
                nameGu: 'બાળ શક્તિ',
                category: 'THR',
                unit: 'packets',
              },
            ],
          },
        } as never;
      }
      if (path === '/api/dispatches' && init?.method === 'POST') {
        return {
          success: true,
          data: {
            id: 'dsp-1',
            dispatchReference: 'DSP-AWC-GDR-01-TEST',
          },
        } as never;
      }
      if (
        path === '/api/dispatches' ||
        path === '/api/discrepancies' ||
        path === '/api/appeals' ||
        path === '/api/stock-requests'
      ) {
        return { success: true, data: [] } as never;
      }
      return { success: true, data: {} } as never;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('requires dispatch proof and vehicle number with a star indicator', async () => {
    render(<SupplierPortal />);

    const createButtons = screen.getAllByRole('button', { name: /Create Dispatch/i });
    fireEvent.click(createButtons[0]);

    const proofInput = await screen.findByLabelText(/Dispatch Proof \/ Challan/i);
    const vehicleInput = screen.getByLabelText(/Vehicle Number/i);

    expect(proofInput).toBeRequired();
    expect(vehicleInput).toBeRequired();

    const proofLabel = proofInput.closest('div')?.querySelector('label');
    const vehicleLabel = vehicleInput.closest('div')?.querySelector('label');
    expect(proofLabel?.textContent).toContain('*');
    expect(vehicleLabel?.textContent).toContain('*');

    const form = proofInput.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Dispatch proof.*required/i);
    });
    expect(api.apiRequest).not.toHaveBeenCalledWith(
      '/api/dispatches',
      expect.objectContaining({ method: 'POST' })
    );

    const file = new File(['%PDF-1.4'], 'challan.pdf', { type: 'application/pdf' });
    fireEvent.change(proofInput, { target: { files: [file] } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Vehicle number is required/i);
    });
    expect(api.apiRequest).not.toHaveBeenCalledWith(
      '/api/dispatches',
      expect.objectContaining({ method: 'POST' })
    );

    fireEvent.change(vehicleInput, { target: { value: 'GJ-17-AB-1234' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(api.apiRequest).toHaveBeenCalledWith(
        '/api/dispatches',
        expect.objectContaining({ method: 'POST' })
      );
    });

    const postCall = vi
      .mocked(api.apiRequest)
      .mock.calls.find(([p, init]) => p === '/api/dispatches' && init?.method === 'POST');
    const body = postCall?.[1]?.body as FormData;
    expect(body.get('vehicleNumber')).toBe('GJ-17-AB-1234');
    expect(body.get('evidence')).toBe(file);
  });
});
