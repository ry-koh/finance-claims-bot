-- relax line_item_index upper bound (previously capped at 5, now supports split claims up to 15)
alter table claim_line_items drop constraint if exists claim_line_items_line_item_index_check;
alter table claim_line_items add constraint claim_line_items_line_item_index_check
  check (line_item_index >= 1);

-- extend claim_documents.type to include split variants (loa_a, loa_b, loa_c, summary_a, etc.)
alter table claim_documents drop constraint if exists claim_documents_type_check;
alter table claim_documents add constraint claim_documents_type_check
  check (type in (
    'loa', 'loa_a', 'loa_b', 'loa_c',
    'summary', 'summary_a', 'summary_b', 'summary_c',
    'rfp', 'rfp_a', 'rfp_b', 'rfp_c',
    'transport', 'email_screenshot', 'compiled'
  ));
