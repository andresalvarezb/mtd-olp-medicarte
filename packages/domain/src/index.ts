export type ActorContext = Readonly<{
  userId: string;
  organizationId: string;
  correlationId: string;
}>;
