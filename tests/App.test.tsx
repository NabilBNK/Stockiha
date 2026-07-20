import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
const mockInvoke = vi.mocked(invoke);

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the application title', async () => {
    mockInvoke.mockResolvedValue({
      name: 'Stockiha',
      version: '0.1.0',
      stage: 'Slice 0',
      status: 'Ready',
    });

    render(<App />);
    expect(screen.getByText('Stockiha')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Connected/)).toBeInTheDocument());
  });

  it('renders the slice heading', async () => {
    mockInvoke.mockResolvedValue({
      name: 'Stockiha',
      version: '0.1.0',
      stage: 'Slice 0',
      status: 'Ready',
    });

    render(<App />);
    expect(screen.getByText('Slice 0 — Technical Foundation')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Connected/)).toBeInTheDocument());
  });

  it('shows connected status after successful backend call', async () => {
    mockInvoke.mockResolvedValue({
      name: 'Stockiha',
      version: '0.1.0',
      stage: 'Slice 0',
      status: 'Ready',
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument();
    });
  });

  it('shows sanitized error message when backend call fails', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Unable to connect to the Stockiha backend.')).toBeInTheDocument();
    });
  });

  it('displays the not-implemented notice', async () => {
    mockInvoke.mockResolvedValue({
      name: 'Stockiha',
      version: '0.1.0',
      stage: 'Slice 0',
      status: 'Ready',
    });

    render(<App />);
    expect(screen.getByText(/Business modules.*not implemented/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Connected/)).toBeInTheDocument());
  });

  it('calls get_app_info command on mount', async () => {
    mockInvoke.mockResolvedValue({
      name: 'Stockiha',
      version: '0.1.0',
      stage: 'Slice 0',
      status: 'Ready',
    });

    render(<App />);
    expect(mockInvoke).toHaveBeenCalledWith('get_app_info');
    await waitFor(() => expect(screen.getByText(/Connected/)).toBeInTheDocument());
  });
});
