const axios = require("axios");

const textBeeConfig = JSON.parse(process.env.TEXTBEE_CONFIG);

async function sendSmsNotifications(members, alertData) {
  const phoneNumbers = [
    ...new Set(
      members
        .map(member => {
          if (!member.phone) {
            return null;
          }

          const phone = String(member.phone).trim();

          if (phone.startsWith("+502")) {
            return phone;
          }

          if (phone.startsWith("502")) {
            return `+${phone}`;
          }

          return `+502${phone}`;
        })
        .filter(Boolean)
    ),
  ];

  if (phoneNumbers.length === 0) {
    console.log("No hay números de teléfono para enviar SMS.");
    return;
  }

  const message =
    "Ubicasure: Se ha detectado un incidente cercano. " +
    "Revisa la aplicación para más información.";

  const results = await Promise.allSettled(
    phoneNumbers.map(phoneNumber =>
      axios.post(
        "https://api.textbee.dev/api/v1/gateway/send-sms",
        {
          recipients: [phoneNumber],
          message,
          deviceId: textBeeConfig.deviceId,
        },
        {
          headers: {
            "x-api-key": textBeeConfig.apiKey,
            "Content-Type": "application/json",
          },
        }
      )
    )
  );

  const successful = results.filter(
    result => result.status === "fulfilled"
  );

  const failed = results.filter(
    result => result.status === "rejected"
  );

  console.log(
    `SMS: ${successful.length} enviados, ${failed.length} fallidos.`
  );

  return results;
}

module.exports = {
  sendSmsNotifications,
};