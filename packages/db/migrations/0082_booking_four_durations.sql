-- At most four meeting lengths (22 Oct 2026): the public page shows four, and the contract and core already refuse a
-- fifth. A page saved with five keeps its first four, in order. The first length is the page's default (no column of
-- its own), so it always stays. Then the check narrows from 1 to 5 to 1 to 4.
--
-- Row security off: the owner bypasses it, and a role it would filter fails here rather than trimming nothing, like
-- 0067. The check's swap briefly locks booking_pages; give up after 5 seconds rather than queue behind traffic, like
-- 0064.
set local lock_timeout = '5s';
--> statement-breakpoint
set local row_security = off;
--> statement-breakpoint
update booking_pages set durations = durations[1:4] where cardinality(durations) > 4;
--> statement-breakpoint
ALTER TABLE "booking_pages" DROP CONSTRAINT "booking_pages_durations";--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_durations" CHECK (cardinality("booking_pages"."durations") between 1 and 4 and "booking_pages"."durations" <@ '{5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,105,110,115,120,125,130,135,140,145,150,155,160,165,170,175,180,185,190,195,200,205,210,215,220,225,230,235,240,245,250,255,260,265,270,275,280,285,290,295,300,305,310,315,320,325,330,335,340,345,350,355,360,365,370,375,380,385,390,395,400,405,410,415,420,425,430,435,440,445,450,455,460,465,470,475,480}'::smallint[]);
