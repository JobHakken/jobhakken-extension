/** Per-company H-1B insights summary (issue #92) — filings, typical wage + range, top roles. */
export type H1bDetail = {
  company: string;
  filings: number; // total LCA cases across the company's legal entities
  wageMedian: number; // case-weighted "typical" annual wage, rounded to $1k (0 = unknown)
  wageMin: number;
  wageMax: number;
  roles: { title: string; filings: number; wageMedian: number }[]; // top standardized roles by filings
};
