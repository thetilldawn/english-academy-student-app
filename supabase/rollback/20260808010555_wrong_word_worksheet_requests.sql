begin;

drop function if exists public.export_wrong_word_worksheet_request_v1(uuid);
drop function if exists public.create_wrong_word_worksheet_request_v1(uuid, uuid[]);

drop table if exists public.worksheet_request_items;
drop table if exists public.worksheet_requests;

commit;
