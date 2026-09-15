CREATE TABLE "hm_fomo_callouts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hm_fomo_callouts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"external_id" text NOT NULL,
	"coin" text NOT NULL,
	"subject" text NOT NULL,
	"handle" text,
	"text" text NOT NULL,
	"token_address" text,
	"network_id" integer,
	"created_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hm_fomo_callouts_external" ON "hm_fomo_callouts" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "hm_fomo_callouts_window" ON "hm_fomo_callouts" USING btree ("coin","created_at");--> statement-breakpoint
CREATE INDEX "hm_fomo_callouts_subject" ON "hm_fomo_callouts" USING btree ("subject");