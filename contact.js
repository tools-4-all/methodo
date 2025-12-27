function handleForm(formId, successMessage) {
    const form = document.getElementById(formId);
  
    form.addEventListener("submit", (e) => {
      e.preventDefault();
  
      const data = Object.fromEntries(new FormData(form).entries());
      console.log(`[${formId}]`, data);
  
      alert(successMessage);
      form.reset();
    });
  }
  
  handleForm("contact-form", "Messaggio inviato. Ti risponderemo presto.");
  handleForm("feedback-form", "Feedback ricevuto. Grazie per aver migliorato il prodotto.");
  