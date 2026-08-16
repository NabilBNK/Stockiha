import { PurchaseTransactionScreen } from './PurchaseTransactionScreen';

interface Props {
  sessionToken: string;
}

/**
 * MVP purchasing entry point.
 *
 * Direct Purchase is the only active operator workflow in this release. The
 * historical Purchase Order implementation remains in the repository for a
 * future advanced policy, but it is deliberately not selectable here.
 */
export default function PurchasesScreen({ sessionToken }: Props) {
  return <PurchaseTransactionScreen sessionToken={sessionToken} />;
}
