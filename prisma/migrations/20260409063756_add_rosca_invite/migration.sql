-- CreateTable
CREATE TABLE "rosca_invites" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rosca_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rosca_invites_token_key" ON "rosca_invites"("token");

-- AddForeignKey
ALTER TABLE "rosca_invites" ADD CONSTRAINT "rosca_invites_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "rosca_circles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
