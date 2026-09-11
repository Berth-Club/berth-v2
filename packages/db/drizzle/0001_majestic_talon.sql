CREATE TABLE "user_profiles" (
	"wallet" text PRIMARY KEY NOT NULL,
	"name" text,
	"bio" text,
	"social" text,
	"image" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
