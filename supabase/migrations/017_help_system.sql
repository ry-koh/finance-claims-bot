create table help_questions (
  id uuid primary key default gen_random_uuid(),
  asker_id uuid not null references finance_team(id) on delete cascade,
  question_text text not null,
  image_urls text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'answered')),
  created_at timestamptz not null default now()
);

create table help_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references help_questions(id) on delete cascade,
  answerer_id uuid not null references finance_team(id) on delete cascade,
  answer_text text not null,
  created_at timestamptz not null default now()
);

create index idx_help_questions_asker on help_questions(asker_id);
create index idx_help_questions_status on help_questions(status);
create index idx_help_answers_question on help_answers(question_id);
create index idx_help_answers_answerer on help_answers(answerer_id);
