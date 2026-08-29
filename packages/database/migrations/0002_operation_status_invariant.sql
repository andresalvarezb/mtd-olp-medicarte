ALTER TABLE "authorization_items" ADD CONSTRAINT "authorization_items_ready_prerequisites_check" CHECK ("authorization_items"."operation_status" IS NULL OR "authorization_items"."operation_status" <> 'READY_TO_DISPENSE' OR (
        "authorization_items"."enablement_status" = 'ENABLED' AND (
          ("authorization_items"."coverage_type" = 'PBS' AND "authorization_items"."direction_status" = 'NOT_APPLICABLE') OR
          ("authorization_items"."coverage_type" = 'NO_PBS' AND "authorization_items"."direction_status" = 'CONFIRMED')
        )
      ));
