/**
 * The shape `JwtStrategy.validate()` attaches to `request.user`.
 *
 * Authorization decisions MUST be resolved from this server-verified identity
 * (or from PostgreSQL via it), never from a client-supplied id — Master TZ §29.
 */
export interface AuthenticatedUser {
  /** `User.id`, serialized as a string in the JWT `sub` claim. */
  userId: string;
  telegramId: string;
}

export interface RequestWithUser {
  user: AuthenticatedUser;
}
