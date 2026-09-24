/**
 * WS-K-7-B — a test-only way to inject a fixed licence status into
 * `useLicence()` consumers without driving the real IPC/event wiring.
 */
import type { ReactNode } from 'react';

import { LicenceContext } from '../src/shared/licence/LicenceContext';
import type { LicenceStatus } from '../src/shared/ipc/licenceDto';

export function LicenceContextForTest({
  value,
  children,
}: {
  value: LicenceStatus | null;
  children: ReactNode;
}) {
  return (
    <LicenceContext.Provider
      value={{
        status: value,
        readOnly: value?.mode === 'READ_ONLY',
        refresh: async () => {},
      }}
    >
      {children}
    </LicenceContext.Provider>
  );
}
