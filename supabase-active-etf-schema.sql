-- ETF daily holding-flow snapshots for PPBears Investment.
-- Source idea: large Taiwan stock ETFs disclose or publish their portfolio composition regularly.
-- Importer should diff each ETF's current holding file against the previous trading day.

create table if not exists active_etf_holdings (
  id bigserial primary key,
  snapshot_date date not null,
  etf_code text not null,
  etf_name text not null default '',
  coid text not null,
  stkname text,
  weight_pct numeric,
  shares numeric,
  source_url text,
  collected_at timestamptz not null default now(),
  unique (snapshot_date, etf_code, coid)
);

create index if not exists active_etf_holdings_etf_date_idx
  on active_etf_holdings (etf_code, snapshot_date desc);

create index if not exists active_etf_holdings_coid_date_idx
  on active_etf_holdings (coid, snapshot_date desc);

create table if not exists active_etf_stock_flows (
  id bigserial primary key,
  flow_date date not null,
  etf_code text not null,
  etf_name text not null default '',
  coid text not null,
  stkname text,
  action text not null check (action in ('added', 'increased', 'decreased', 'removed', 'held')),
  weight_pct numeric,
  previous_weight_pct numeric,
  weight_change_pct numeric,
  shares numeric,
  previous_shares numeric,
  share_change numeric,
  source_url text,
  collected_at timestamptz not null default now(),
  unique (flow_date, etf_code, coid)
);

create index if not exists active_etf_stock_flows_coid_date_idx
  on active_etf_stock_flows (coid, flow_date desc);

create index if not exists active_etf_stock_flows_etf_date_idx
  on active_etf_stock_flows (etf_code, flow_date desc);

comment on table active_etf_stock_flows is
  'Daily ETF holding changes diffed from disclosed portfolio files.';

comment on table active_etf_holdings is
  'Daily ETF disclosed portfolio snapshots before diffing.';
