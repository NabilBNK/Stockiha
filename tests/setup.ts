import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

/**
 * WS-D-9B — raise testing-library's async utility timeout from its 1000ms
 * default to 5000ms.
 *
 * Every workflow test in this repository mounts the whole <App /> and runs a
 * login, and the files execute in parallel. At ~250 tests the suite sat close
 * enough to the 1s ceiling that adding coverage to one file made an unrelated
 * file's `waitFor` time out — a scheduling artefact, not a behaviour change,
 * since each file passed in isolation. That pressure was starting to shape
 * test design (fold cases together to stay under the wire), which is the wrong
 * trade: coverage should not be rationed to suit a timer.
 *
 * 5000ms is a ceiling, not a delay — a `waitFor` that resolves in 10ms still
 * resolves in 10ms. It only changes how long a genuinely stuck assertion takes
 * to report, and vitest's own per-test timeout still bounds that.
 */
configure({ asyncUtilTimeout: 5000 });
