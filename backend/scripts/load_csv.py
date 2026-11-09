#!/usr/bin/env python3
"""
Load CSV data into users_db (companies and groups tables)
Usage: python load_csv.py --companies target_companies.csv --groups target_groups.csv --dsn "postgres://user:pass@host:5432/users_db"
"""

import argparse
import json
import sys
import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError


def parse_json_field(val):
    """Parse JSON field from CSV (handles empty strings and NaN)"""
    if pd.isna(val) or val == '' or val == '[]' or val == '{}':
        return None
    try:
        return json.loads(val)
    except json.JSONDecodeError:
        # Try to handle malformed JSON
        if val.startswith('[') and val.endswith(']'):
            # Array-like
            return json.loads(val.replace("'", '"'))
        elif val.startswith('{') and val.endswith('}'):
            # Object-like
            return json.loads(val.replace("'", '"'))
        return None


def load_companies(engine, csv_path):
    """Load companies from CSV"""
    print(f"Loading companies from {csv_path}...")

    # Read CSV with proper settings
    df = pd.read_csv(csv_path, sep=';', encoding='utf-8-sig', dtype=str)
    print(f"  Read {len(df)} rows")

    # Convert boolean columns (0.0/1.0 -> True/False)
    bool_cols = [
        'CL_PRODUCT_RKO_MARK', 'CL_PRODUCT_GAR_MARK', 'CL_PRODUCT_LOA_MARK',
        'CL_PRODUCT_LEA_MARK', 'CL_PRODUCT_DEP_MARK', 'CL_PRODUCT_ZPP_MARK',
        'FACTORING_MARK'
    ]
    for col in bool_cols:
        if col in df.columns:
            df[col] = df[col].map({'1.0': True, '1': True, '0.0': False, '0': False, 'true': True, 'false': False})

    # Parse JSON fields
    json_cols = ['ADDITIONAL_SECTORS']
    for col in json_cols:
        if col in df.columns:
            df[col] = df[col].apply(parse_json_field)

    # Convert revenue to int
    if 'REVENUE_COMPANY' in df.columns:
        df['REVENUE_COMPANY'] = pd.to_numeric(df['REVENUE_COMPANY'], errors='coerce').fillna(0).astype(int)

    # Rename columns to match database schema
    column_map = {
        'SYNTHETIC_U': 'synthetic_u',
        'ORG_TYPE': 'org_type',
        'OKFS_NAME': 'okfs_name',
        'COMPANY_AGE_YEARS_GRADATION': 'company_age_years_gradation',
        'ECO_MARK_LABEL': 'eco_mark_label',
        'MAINOKVED_CODE': 'mainokved_code',
        'MAINOKVED_NAME': 'mainokved_name',
        'AMOUNT_WORKERS_FNS_GRADATION': 'amount_workers_fns_gradation',
        'CL_TYPE': 'cl_type',
        'CL_PRODUCT_RKO_MARK': 'cl_product_rko_mark',
        'CL_PRODUCT_GAR_MARK': 'cl_product_gar_mark',
        'CL_PRODUCT_LOA_MARK': 'cl_product_loa_mark',
        'CL_PRODUCT_LEA_MARK': 'cl_product_lea_mark',
        'CL_PRODUCT_DEP_MARK': 'cl_product_dep_mark',
        'CL_PRODUCT_ZPP_MARK': 'cl_product_zpp_mark',
        'FTS_COUNTRY_NAME': 'fts_country_name',
        'FACTORING_MARK': 'factoring_mark',
        'REVENUE_COMPANY': 'revenue_company',
        'GROUP_ID': 'group_id',
        'CITY': 'city',
        'REGION': 'region',
        'BUSINESS_SIZE_FNS': 'business_size_fns',
        'ADDITIONAL_SECTORS': 'additional_sectors',
    }
    df = df.rename(columns=column_map)

    # Insert data
    inserted = 0
    updated = 0
    errors = 0

    with engine.begin() as conn:
        for _, row in df.iterrows():
            try:
                # Build upsert query
                cols = [c for c in df.columns if c in column_map.values()]
                placeholders = ', '.join([f':{c}' for c in cols])
                updates = ', '.join([f'{c} = EXCLUDED.{c}' for c in cols if c != 'synthetic_u'])

                query = f"""
                    INSERT INTO companies ({', '.join(cols)})
                    VALUES ({placeholders})
                    ON CONFLICT (synthetic_u) DO UPDATE SET {updates}
                """

                # Prepare parameters
                params = {c: row[c] for c in cols}
                # Convert JSON fields to JSONB
                for c in json_cols:
                    if c in params and params[c] is not None:
                        params[c] = json.dumps(params[c])

                conn.execute(text(query), params)
                inserted += 1

            except Exception as e:
                errors += 1
                print(f"  Error inserting {row.get('synthetic_u', 'unknown')}: {e}")

    print(f"  Companies: {inserted} inserted/updated, {errors} errors")


def load_groups(engine, csv_path):
    """Load groups from CSV"""
    print(f"Loading groups from {csv_path}...")

    df = pd.read_csv(csv_path, sep=';', encoding='utf-8-sig', dtype=str)
    print(f"  Read {len(df)} rows")

    # Parse JSON fields
    json_array_cols = [
        'TARGET_COMPANY_IDS', 'OWN_SECTORS', 'MAINOKVED_CODES', 'REGIONS',
        'CITIES', 'FTS_COUNTRIES', 'OWNERSHIP_FORMS', 'DEVELOPMENT_STAGES',
        'ADDITIONAL_SECTORS'
    ]
    json_object_cols = ['MAINOKVED_NAMES']

    for col in json_array_cols + json_object_cols:
        if col in df.columns:
            df[col] = df[col].apply(parse_json_field)

    # Convert revenue to int
    if 'REVENUE_SUM' in df.columns:
        df['REVENUE_SUM'] = pd.to_numeric(df['REVENUE_SUM'], errors='coerce').fillna(0).astype(int)

    # Rename columns
    column_map = {
        'GROUP_ID': 'group_id',
        'TARGET_COMPANY_IDS': 'target_company_ids',
        'REVENUE_SUM': 'revenue_sum',
        'BUSINESS_SIZE_BANK': 'business_size_bank',
        'OWN_SECTORS': 'own_sectors',
        'MAINOKVED_CODES': 'mainokved_codes',
        'REGIONS': 'regions',
        'CITIES': 'cities',
        'FTS_COUNTRIES': 'fts_countries',
        'OWNERSHIP_FORMS': 'ownership_forms',
        'DEVELOPMENT_STAGES': 'development_stages',
        'MAINOKVED_NAMES': 'mainokved_names',
        'ADDITIONAL_SECTORS': 'additional_sectors',
    }
    df = df.rename(columns=column_map)

    # Insert data
    inserted = 0
    errors = 0

    with engine.begin() as conn:
        for _, row in df.iterrows():
            try:
                cols = [c for c in df.columns if c in column_map.values()]
                placeholders = ', '.join([f':{c}' for c in cols])
                updates = ', '.join([f'{c} = EXCLUDED.{c}' for c in cols if c != 'group_id'])

                query = f"""
                    INSERT INTO groups ({', '.join(cols)})
                    VALUES ({placeholders})
                    ON CONFLICT (group_id) DO UPDATE SET {updates}
                """

                params = {c: row[c] for c in cols}
                # Convert JSON fields to JSONB
                for c in json_array_cols + json_object_cols:
                    if c in params and params[c] is not None:
                        params[c] = json.dumps(params[c])

                conn.execute(text(query), params)
                inserted += 1

            except Exception as e:
                errors += 1
                print(f"  Error inserting {row.get('group_id', 'unknown')}: {e}")

    print(f"  Groups: {inserted} inserted/updated, {errors} errors")


def main():
    parser = argparse.ArgumentParser(description='Load CSV data into users_db')
    parser.add_argument('--companies', required=True, help='Path to target_companies.csv')
    parser.add_argument('--groups', required=True, help='Path to target_groups.csv')
    parser.add_argument('--dsn', required=True, help='PostgreSQL DSN for users_db')

    args = parser.parse_args()

    # Create engine
    engine = create_engine(args.dsn)

    try:
        # Test connection
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("Database connection OK")

        # Load data
        load_companies(engine, args.companies)
        load_groups(engine, args.groups)

        print("Done!")

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()