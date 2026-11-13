CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_id" integer NOT NULL,
	"repository_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"body" text,
	"state" varchar(50) NOT NULL,
	"html_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "issues_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"owner" varchar(255) NOT NULL,
	"html_url" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "repositories_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_repository_id_idx" ON "issues" USING btree ("repository_id");