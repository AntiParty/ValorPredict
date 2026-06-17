import { Link } from "react-router-dom";

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Valorant Auto Predictions home">
      <span className="brand-mark" aria-hidden="true">
        <i />
      </span>
      <span>VAP</span>
    </Link>
  );
}
