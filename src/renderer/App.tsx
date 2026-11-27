import { PRODUCT_NAME } from '../shared/product';

export function App(): React.JSX.Element {
  return (
    <main className="page">
      <h1 className="product-name">{PRODUCT_NAME}</h1>
    </main>
  );
}
