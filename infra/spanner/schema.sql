-- Integrity network on Spanner Graph (GoogleSQL dialect).
-- Matches backend/app/services/network_spanner.py. Phone numbers, accounts and employer names are
-- stored only as salted HMAC hashes; raw values never reach this database.
--
-- Apply with:
--   gcloud spanner databases ddl update $SPANNER_DATABASE --instance=$SPANNER_INSTANCE --ddl-file=infra/spanner/schema.sql
-- Not yet applied to a live instance by the authors: run it once in a scratch database first.

CREATE TABLE Recruiters (
  rkey  STRING(100) NOT NULL,
  label STRING(200),
) PRIMARY KEY (rkey);

CREATE TABLE Phones (
  phone_hash STRING(100) NOT NULL,
) PRIMARY KEY (phone_hash);

CREATE TABLE Accounts (
  account_hash STRING(100) NOT NULL,
) PRIMARY KEY (account_hash);

CREATE TABLE Cases (
  case_id       STRING(64) NOT NULL,
  fraud         BOOL,
  wage_problem  BOOL,
  employer_hash STRING(100),
) PRIMARY KEY (case_id);

CREATE TABLE Layouts (
  layout_hash    STRING(64) NOT NULL,
  confirmed_fake BOOL,
) PRIMARY KEY (layout_hash);

CREATE TABLE RecruiterPhone (
  rkey       STRING(100) NOT NULL,
  phone_hash STRING(100) NOT NULL,
) PRIMARY KEY (rkey, phone_hash);

CREATE TABLE RecruiterAccount (
  rkey         STRING(100) NOT NULL,
  account_hash STRING(100) NOT NULL,
) PRIMARY KEY (rkey, account_hash);

CREATE TABLE RecruiterCase (
  rkey    STRING(100) NOT NULL,
  case_id STRING(64) NOT NULL,
) PRIMARY KEY (rkey, case_id);

CREATE TABLE AccountCase (
  account_hash STRING(100) NOT NULL,
  case_id      STRING(64) NOT NULL,
) PRIMARY KEY (account_hash, case_id);

CREATE TABLE LayoutCase (
  layout_hash STRING(64) NOT NULL,
  case_id     STRING(64) NOT NULL,
) PRIMARY KEY (layout_hash, case_id);

CREATE INDEX CasesByEmployer ON Cases (employer_hash);
CREATE INDEX RecruiterPhoneByPhone ON RecruiterPhone (phone_hash);
CREATE INDEX RecruiterAccountByAccount ON RecruiterAccount (account_hash);

CREATE PROPERTY GRAPH IntegrityGraph
  NODE TABLES (
    Recruiters,
    Phones,
    Accounts,
    Cases,
    Layouts
  )
  EDGE TABLES (
    RecruiterPhone
      SOURCE KEY (rkey) REFERENCES Recruiters (rkey)
      DESTINATION KEY (phone_hash) REFERENCES Phones (phone_hash)
      LABEL USES_PHONE,
    RecruiterAccount
      SOURCE KEY (rkey) REFERENCES Recruiters (rkey)
      DESTINATION KEY (account_hash) REFERENCES Accounts (account_hash)
      LABEL USES_ACCOUNT,
    RecruiterCase
      SOURCE KEY (rkey) REFERENCES Recruiters (rkey)
      DESTINATION KEY (case_id) REFERENCES Cases (case_id)
      LABEL REPORTED_IN,
    AccountCase
      SOURCE KEY (account_hash) REFERENCES Accounts (account_hash)
      DESTINATION KEY (case_id) REFERENCES Cases (case_id)
      LABEL PAID_IN,
    LayoutCase
      SOURCE KEY (layout_hash) REFERENCES Layouts (layout_hash)
      DESTINATION KEY (case_id) REFERENCES Cases (case_id)
      LABEL SEEN_IN
  );
